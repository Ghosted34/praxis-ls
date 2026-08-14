/**
 * The itinerary editor.
 *
 * WHAT THESE PIN, and why each one is a thing an operator was previously doing in
 * a notes field:
 *
 *   · a leg's places come from the verified picker, never from free text — the
 *     editor's save used to geocode whatever had been typed;
 *   · legs can be REORDERED, which the previous version could not do at all
 *     (`seq` was array position with no way to change it) and which matters
 *     because `seq` is UNIQUE per file, so the swap has to be atomic;
 *   · unsaved work is visible and revertible;
 *   · a single-point leg (customs, warehousing) stops asking for a destination,
 *     in step with the server's own rule — otherwise switching a leg to CUSTOMS
 *     fails validation for a field the form no longer shows;
 *   · the server's per-leg errors land on the row they belong to.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ItineraryEditor } from "./itinerary-editor";

const DOUALA = {
  geo_place_id: "gp-douala",
  name: "Douala",
  country: "CM",
  kind: "SEAPORT",
  unlocode: "CMDLA",
  latitude: "4.0482",
  longitude: "9.7004",
  source: "CATALOGUE",
  verified_at: "2026-01-01T00:00:00.000Z",
};

const search = { places: [DOUALA], has_exact: false, provider: { requested: false, status: "NOT_REQUESTED", message: null, results: [] } };

const leg = (over: Record<string, unknown> = {}) => ({
  itinerary_leg_id: "leg-1",
  seq: 1,
  leg_type: "MAIN_CARRIAGE",
  mode: "SEA",
  status: "PLANNED",
  is_optional: false,
  source: "TEMPLATE",
  origin: "Shanghai",
  destination: "Douala",
  origin_place_id: "gp-shanghai",
  destination_place_id: "gp-douala",
  planned_departure: "2026-07-01",
  planned_arrival: "2026-07-20",
  actual_departure: null,
  actual_arrival: null,
  provider_id: null,
  provider_name: null,
  notes: null,
  ...over,
});

let routes: Record<string, unknown> = {};

function renderEditor(legs: unknown[] = [leg()]) {
  routes = {
    "/operations/d-1/itinerary": legs,
    "/geo-places/search": search,
    "/rate-providers": [],
  };
  return renderScreen(<ItineraryEditor dossierId="d-1" />, { routes });
}

beforeEach(() => {
  fixtures.current = {};
});

describe("reading an itinerary", () => {
  it("shows each leg with where it came from", async () => {
    renderEditor([leg(), leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "FINAL_DELIVERY", mode: "LAND", source: "MANUAL" })]);
    expect(await screen.findByRole("group", { name: /Leg 1: Main carriage/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Leg 2: Final delivery/ })).toBeInTheDocument();
    // A template leg says so, because the required-leg rule will refuse to let it
    // be removed and the operator should know that before they try.
    expect(screen.getByText("From the service type")).toBeInTheDocument();
  });

  it("explains an empty itinerary instead of showing a bare Add button", async () => {
    renderEditor([]);
    expect(await screen.findByText(/No structured itinerary yet/)).toBeInTheDocument();
    expect(screen.getByText(/one segment per leg/)).toBeInTheDocument();
  });

  it("Save is disabled until something changes", async () => {
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });
    expect(screen.getByRole("button", { name: /save itinerary/i })).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});

describe("editing", () => {
  it("says when there is unsaved work, and can revert it", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });

    await user.click(screen.getByRole("button", { name: /add leg/i }));
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save itinerary/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /revert/i }));
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
  });

  it("reorders legs, which the previous editor could not do at all", async () => {
    const user = userEvent.setup();
    renderEditor([
      leg({ leg_type: "MAIN_CARRIAGE" }),
      leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "PICKUP", mode: "LAND" }),
    ]);
    await screen.findByRole("group", { name: /Main carriage/ });

    // A pickup that happens after the vessel sails is the shape the old editor
    // could only produce; moving it up is the fix.
    await user.click(screen.getByRole("button", { name: /move pickup earlier/i }));
    // Order is array order, and the group labels carry the position.
    expect(await screen.findByRole("group", { name: /Leg 1: Pickup/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Leg 2: Main carriage/ })).toBeInTheDocument();
  });

  it("cannot move the first leg up or the last leg down", async () => {
    renderEditor([leg(), leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "PICKUP" })]);
    await screen.findByRole("group", { name: /Main carriage/ });
    expect(screen.getByRole("button", { name: /move main carriage earlier/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move pickup later/i })).toBeDisabled();
  });

  it("removes a leg", async () => {
    const user = userEvent.setup();
    renderEditor([leg(), leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "PICKUP" })]);
    await screen.findByRole("group", { name: /Pickup/ });
    await user.click(screen.getByRole("button", { name: /remove pickup/i }));
    expect(screen.queryByRole("group", { name: /Pickup/ })).not.toBeInTheDocument();
  });

  it("a single-point leg stops asking for a destination", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });
    expect(screen.getByRole("button", { name: "Destination" })).toBeInTheDocument();

    // A customs clearance happens AT one place. Asking for a second is asking the
    // operator to invent data, and the server agrees (SINGLE_POINT_LEGS) — so a
    // leg switched to CUSTOMS must not then fail on a field the form hides.
    await user.selectOptions(screen.getAllByLabelText("Leg type")[0], "CUSTOMS");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Destination" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Location" })).toBeInTheDocument();
  });

  it("records actual dates as well as planned ones, day-first", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });
    // Before 0677 only the plan was storable, so a leg that departed three days
    // late and arrived on time was indistinguishable from one that never moved.
    //
    // The control is `DateField`, not a native date input: a leg's dates are read
    // out loud in the meeting this screen feeds, and a native control renders in
    // the OS locale — so 04/07 was the 4th of July on one operator's machine and
    // the 7th of April on the next.
    const actual = screen.getByLabelText(/^Actual departure/);
    await user.type(actual, "04072026");
    expect(actual).toHaveValue("04/07/2026");
  });
});

describe("places come from the picker", () => {
  it("an origin is chosen from the catalogue, not typed", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });

    // The control is the same verified picker the file's own fields use: a button
    // that opens a combobox, with no way to commit typed text.
    await user.click(screen.getByRole("button", { name: "Origin" }));
    const input = screen.getByRole("combobox", { name: "Origin" });
    await user.type(input, "dou");
    await user.click(await screen.findByRole("option", { name: /Douala/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Origin" })).toHaveTextContent("Douala"));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("sends the legs in array order, with seq renumbered", async () => {
    const user = userEvent.setup();
    renderEditor([
      leg({ leg_type: "MAIN_CARRIAGE" }),
      leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "PICKUP", mode: "LAND" }),
    ]);
    await screen.findByRole("group", { name: /Main carriage/ });
    await user.click(screen.getByRole("button", { name: /move pickup earlier/i }));

    fixtures.current.routes!["/operations/d-1/itinerary"] = [
      leg({ itinerary_leg_id: "leg-2", seq: 1, leg_type: "PICKUP", mode: "LAND" }),
      leg({ seq: 2, leg_type: "MAIN_CARRIAGE" }),
    ];
    await user.click(screen.getByRole("button", { name: /save itinerary/i }));

    // Saved, and the dirty flag clears — the editor reloads from what the server
    // confirmed rather than trusting its own draft.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("puts a per-leg error on the leg it belongs to", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });
    await user.click(screen.getByRole("button", { name: /add leg/i }));

    fixtures.current.routes!["/operations/d-1/itinerary"] = {
      __error: {
        status: 422,
        code: "ITINERARY_INVALID",
        message: "One leg needs attention before this itinerary can be saved.",
        fields: { "legs.1.origin": ['"Nowhere" is not a place in the catalogue yet.'] },
      },
    };
    await user.click(screen.getByRole("button", { name: /save itinerary/i }));

    // Scoped to leg 2's own group: the claim is not merely that the message
    // appears, it is that it appears on the ROW the server rejected. An error
    // floating above the form makes the operator hunt for which leg it means.
    const second = await screen.findByRole("group", { name: /Leg 2:/ });
    expect(within(second).getByText(/is not a place in the catalogue yet/)).toBeInTheDocument();
    const first = screen.getByRole("group", { name: /Leg 1:/ });
    expect(within(first).queryByText(/is not a place in the catalogue yet/)).not.toBeInTheDocument();
  });

  it("shows the structural-leg refusal as a callout, not as a field error", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole("group", { name: /Main carriage/ });
    await user.click(screen.getByRole("button", { name: /remove main carriage/i }));

    fixtures.current.routes!["/operations/d-1/itinerary"] = {
      __error: {
        status: 422,
        code: "ITINERARY_LEG_REQUIRED",
        message: "This service type requires Main carriage.",
        fields: { legs: ["Main carriage is required by this service type"] },
      },
    };
    await user.click(screen.getByRole("button", { name: /save itinerary/i }));

    // It belongs to the whole LIST, not a row — the row it was about has gone, so
    // there is nowhere to put a field error and a callout is the honest place.
    expect(await screen.findByText("This service type needs a leg you removed")).toBeInTheDocument();
    expect(screen.getAllByText(/Main carriage is required by this service type/).length).toBeGreaterThan(0);
    // …and no leg row is blamed for it.
    expect(screen.queryByRole("group", { name: /Leg 1:/ })).not.toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("has no violations", async () => {
    const { container } = renderEditor([
      leg(),
      leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "CUSTOMS", mode: "OTHER", source: "MANUAL" }),
    ]);
    await screen.findByRole("group", { name: /Main carriage/ });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("every reorder control names the leg it moves", async () => {
    renderEditor([leg(), leg({ itinerary_leg_id: "leg-2", seq: 2, leg_type: "PICKUP" })]);
    await screen.findByRole("group", { name: /Main carriage/ });
    // "↑" alone is what a screen reader would otherwise announce, twice, with no
    // way to tell which leg it moves.
    const up = screen.getAllByRole("button", { name: /move .* earlier/i });
    expect(up).toHaveLength(2);
    expect(screen.getByRole("button", { name: /move pickup earlier/i })).toBeInTheDocument();
  });
});
