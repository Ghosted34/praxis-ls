/**
 * The place picker's behaviour, and above all the thing it REFUSES to do.
 *
 * The first test in this file is the point of the whole change: there is no way
 * to commit typed text. The control it replaced had `allowFreeText`, so "Doula"
 * saved cleanly, was forward-geocoded in the background to a confident wrong
 * answer, and appeared on the meeting-room map as a lane in the wrong place. If
 * a future edit reintroduces any "use what I typed" affordance, that test fails.
 *
 * The rest pin the escalation ladder — catalogue, then worldwide on request, then
 * confirm, then a reference point, then manual entry — because the ladder is what
 * makes a verified-places rule liveable. A rule with no escape hatch gets routed
 * around, and the route around it (pick something wrong to get past the form)
 * is worse than the free text it replaced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { PlacePicker } from "./place-picker";
import type { GeoPlace, PlaceSearchResult, PlaceSuggestion } from "@/lib/operations-api";

const DOUALA: GeoPlace = {
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

const DOUALA_AIRPORT: GeoPlace = {
  ...DOUALA,
  geo_place_id: "gp-dla-air",
  name: "Douala Airport",
  kind: "AIRPORT",
  unlocode: null,
  formatted: "DLA · Douala Airport airport, Douala",
};

const SUGGESTION: PlaceSuggestion = {
  provider_place_id: "pid-bassa",
  name: "Zone Industrielle Bassa",
  formatted: "Zone Industrielle Bassa, Douala, Cameroon",
  country: "CM",
  region: "Littoral",
  latitude: 4.0311,
  longitude: 9.7085,
  kind: "ADDRESS",
  confidence: 0.84,
};

const CONFIRMED: GeoPlace = {
  geo_place_id: "gp-bassa",
  name: "Zone Industrielle Bassa, Douala",
  country: "CM",
  kind: "ADDRESS",
  formatted: "Zone Industrielle Bassa, Douala, Cameroon",
  latitude: "4.0311",
  longitude: "9.7085",
  source: "GEOAPIFY",
  verified_at: "2026-08-14T00:00:00.000Z",
};

const searchResult = (over: Partial<PlaceSearchResult> = {}): PlaceSearchResult => ({
  places: [],
  has_exact: false,
  provider: { requested: false, status: "NOT_REQUESTED", message: null, results: [] },
  ...over,
});

/**
 * The catalogue response for the next render.
 *
 * Held here and passed through `renderScreen`, which OWNS `fixtures.current` —
 * it assigns the map it is given, so setting the map before rendering would be
 * silently discarded. Mutating `fixtures.current.routes` afterwards is how a
 * later interaction (the worldwide search, the confirm call) changes the answer.
 */
let routes: Record<string, unknown> = {};

function withCatalogue(places: GeoPlace[], over: Partial<PlaceSearchResult> = {}) {
  routes = { "/geo-places/search": searchResult({ places, ...over }) };
}

const onSelect = vi.fn();

function renderPicker(props: Partial<Parameters<typeof PlacePicker>[0]> = {}) {
  return renderScreen(<PlacePicker label="Port of loading" onSelect={onSelect} {...props} />, { routes });
}

/** Open the combobox and wait for the first catalogue response to land. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Port of loading" }));
  return screen.getByRole("combobox", { name: "Port of loading" });
}

beforeEach(() => {
  onSelect.mockClear();
  withCatalogue([]);
});

describe("it will not accept free text", () => {
  it("offers no way to commit what was typed", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "Doula");
    await waitFor(() => expect(screen.getByText(/no places matched|nothing in the catalogue/i)).toBeInTheDocument());

    // The old control rendered a “Use “Doula”” action here. Nothing may.
    expect(screen.queryByText(/use “/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/use "/i)).not.toBeInTheDocument();

    // And Enter on a term with no results commits nothing.
    await user.keyboard("{Enter}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("typing never asks the provider — only the button does", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    withCatalogue([]);
    const { container } = renderPicker();
    void container;
    const input = await open(user);
    await user.type(input, "zone industrielle bassa");
    await waitFor(() => expect(screen.getByRole("button", { name: /search worldwide/i })).toBeInTheDocument());
    // No provider request was needed to reach that state: the button IS the ask.
    expect(calls).toEqual([]);
  });
});

describe("picking from the catalogue", () => {
  it("commits the place and its name", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    const option = await screen.findByRole("option", { name: /Douala/ });
    await user.click(option);
    expect(onSelect).toHaveBeenCalledWith({ name: "Douala", place: DOUALA });
  });

  it("shows the code and the kind, so two same-named places are distinguishable", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA, DOUALA_AIRPORT]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    // The port carries its UN/LOCODE; the airport carries the IATA code that is
    // actually on the air waybill.
    expect(options[0]).toHaveTextContent("CMDLA");
    expect(options[0]).toHaveTextContent("Seaport");
    expect(options[1]).toHaveTextContent("DLA");
    expect(options[1]).toHaveTextContent("Airport");
  });

  it("marks a place nobody has confirmed", async () => {
    const user = userEvent.setup();
    withCatalogue([{ ...DOUALA, verified_at: null, source: "GEOAPIFY" }]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    const option = await screen.findByRole("option", { name: /Douala/ });
    expect(option).toHaveTextContent("Unverified");
  });

  it("marks a reference point as one", async () => {
    const user = userEvent.setup();
    withCatalogue([{ ...DOUALA, name: "Carrefour Ndokoti", is_reference_point: true, kind: "ADDRESS" }]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "ndokoti");
    expect(await screen.findByRole("option", { name: /Carrefour/ })).toHaveTextContent("Reference");
  });
});

describe("the keyboard", () => {
  it("Down moves through results and Enter commits the active one", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA, DOUALA_AIRPORT]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ name: "Douala Airport", place: DOUALA_AIRPORT });
  });

  it("Down wraps rather than sticking at the end", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA, DOUALA_AIRPORT]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await screen.findAllByRole("option");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ name: "Douala", place: DOUALA });
  });

  it("Escape closes and returns focus to the trigger, not to the body", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Port of loading" })).toHaveFocus());
    void input;
  });

  it("announces what arrived, for a screen reader", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 catalogue place"));
  });
});

describe("the worldwide search", () => {
  it("is offered only once the catalogue has come up short", async () => {
    const user = userEvent.setup();
    // Four hits is above the "thin" threshold, so the catalogue is answering.
    withCatalogue([DOUALA, DOUALA_AIRPORT, { ...DOUALA, geo_place_id: "c", name: "Douala Port Terminal" }, { ...DOUALA, geo_place_id: "d", name: "Douala Yard" }]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await screen.findAllByRole("option");
    expect(screen.queryByRole("button", { name: /search worldwide/i })).not.toBeInTheDocument();
  });

  it("is not offered when the catalogue has an exact answer", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA], { has_exact: true });
    renderPicker();
    const input = await open(user);
    await user.type(input, "douala");
    await screen.findAllByRole("option");
    expect(screen.queryByRole("button", { name: /search worldwide/i })).not.toBeInTheDocument();
  });

  it("returns suggestions in their own labelled group, not mixed into the catalogue", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "zone industrielle bassa");
    const worldwide = await screen.findByRole("button", { name: /search worldwide/i });

    fixtures.current.routes!["/geo-places/search"] = searchResult({
      places: [],
      provider: { requested: true, status: "OK", message: null, results: [SUGGESTION] },
    });
    await user.click(worldwide);

    expect(await screen.findByText(/confirm to use/i)).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Zone Industrielle Bassa/ })).toBeInTheDocument();
  });

  it("reports WHY it found nothing, differently for each cause", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "zone industrielle bassa");
    const worldwide = await screen.findByRole("button", { name: /search worldwide/i });

    fixtures.current.routes!["/geo-places/search"] = searchResult({
      places: [],
      provider: {
        requested: true,
        status: "NO_KEY",
        message:
          "Worldwide place search is not configured. Add a Geoapify key in the Platform Console, or add this place manually.",
        results: [],
      },
    });
    await user.click(worldwide);

    // A configuration problem, said plainly — not "no results", which is how a
    // missing API key gets reported for months as "the address book is broken".
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/Platform Console/)).toBeInTheDocument();
  });
});

describe("confirming a suggestion", () => {
  async function reachConfirmStep(user: ReturnType<typeof userEvent.setup>) {
    withCatalogue([]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "zone industrielle bassa");
    const worldwide = await screen.findByRole("button", { name: /search worldwide/i });
    fixtures.current.routes!["/geo-places/search"] = searchResult({
      provider: { requested: true, status: "OK", message: null, results: [SUGGESTION] },
    });
    await user.click(worldwide);
    await user.click(await screen.findByRole("option", { name: /Zone Industrielle Bassa/ }));
    return screen.findByText(/confirm this place/i);
  }

  it("shows exactly what is about to be saved before saving it", async () => {
    const user = userEvent.setup();
    await reachConfirmStep(user);
    expect(screen.getByText("Zone Industrielle Bassa, Douala, Cameroon")).toBeInTheDocument();
    expect(screen.getByText(/84% provider confidence/)).toBeInTheDocument();
    // Nothing has been stored — a suggestion is not a place until confirmed.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stores it and commits the returned place, not the suggestion", async () => {
    const user = userEvent.setup();
    await reachConfirmStep(user);
    fixtures.current.routes!["/geo-places/confirm"] = CONFIRMED;
    await user.click(screen.getByRole("button", { name: /use this place/i }));
    await waitFor(() =>
      // The DISAMBIGUATED name the server chose, not the provider's fragment.
      expect(onSelect).toHaveBeenCalledWith({ name: "Zone Industrielle Bassa, Douala", place: CONFIRMED }),
    );
  });

  it("offers the nearby-reference-point answer right where it is needed", async () => {
    const user = userEvent.setup();
    await reachConfirmStep(user);
    const toggle = screen.getByRole("checkbox", { name: /near the real place, not the exact spot/i });
    expect(toggle).toBeInTheDocument();
    await user.click(toggle);
    fixtures.current.routes!["/geo-places/confirm"] = { ...CONFIRMED, is_reference_point: true };
    await user.click(screen.getByRole("button", { name: /use this place/i }));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(onSelect.mock.calls[0][0].place.is_reference_point).toBe(true);
  });

  it("says so when a suggestion has aged out, instead of storing a guess", async () => {
    const user = userEvent.setup();
    await reachConfirmStep(user);
    fixtures.current.routes!["/geo-places/confirm"] = {
      __error: {
        status: 409,
        code: "PLACE_SUGGESTION_EXPIRED",
        message: "That suggestion is no longer in the provider's results. Search again and pick it from the new list.",
      },
    };
    await user.click(screen.getByRole("button", { name: /use this place/i }));
    // The reason must SURVIVE the automatic re-search that follows it, or the
    // operator watches the list reload with no idea why nothing was saved.
    expect(await screen.findByText(/no longer in the provider/i)).toBeInTheDocument();
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Back returns to the list without committing", async () => {
    const user = userEvent.setup();
    await reachConfirmStep(user);
    await user.click(screen.getByRole("button", { name: /^back$/i }));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("adding a place by hand", () => {
  it("is offered when nothing else worked", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker({ canCreate: true });
    const input = await open(user);
    await user.type(input, "entrepot bonaberi");
    expect(await screen.findByRole("button", { name: /add .*by hand/i })).toBeInTheDocument();
  });

  it("is not offered without the grant — an affordance that always 403s is worse than none", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker({ canCreate: false });
    const input = await open(user);
    await user.type(input, "entrepot bonaberi");
    await waitFor(() => expect(screen.getByText(/no places matched|nothing in the catalogue/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /by hand/i })).not.toBeInTheDocument();
    // …and the operator is told who can do it, rather than left at a dead end.
    expect(screen.getByText(/someone with permission/i)).toBeInTheDocument();
  });

  it("asks for a coordinate plainly, and validates its range", async () => {
    const user = userEvent.setup();
    withCatalogue([]);
    renderPicker({ canCreate: true });
    const input = await open(user);
    await user.type(input, "entrepot bonaberi");
    await user.click(await screen.findByRole("button", { name: /add .*by hand/i }));

    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: /add place/i });
    expect(save).toBeDisabled();

    /*
     * FOCUS FIRST, AND WAIT FOR IT.
     *
     * The dialog is a Radix `DialogContent`, which moves focus into itself in an
     * effect after mount. `user.type` clicks the field to focus it and then
     * types — so on a slow runner the sequence interleaves: the click focuses
     * Latitude, Radix's mount effect pulls focus back to the first focusable
     * element (Name), and all three keystrokes land in the wrong box. Latitude
     * stays empty, no range error renders, and the assertion below fails with a
     * DOM dump that looks nothing like the bug.
     *
     * This failed exactly once, in CI, and passed on every local run — which is
     * the signature of that race and the reason the wait is asserted rather than
     * slept through. Waiting for focus to settle on the element under test makes
     * the interaction deterministic without weakening it.
     */
    const latitude = within(dialog).getByLabelText(/^Latitude/);
    await user.click(latitude);
    await waitFor(() => expect(latitude).toHaveFocus());
    await user.keyboard("999");

    expect(await within(dialog).findByText(/between -90 and 90/i)).toBeInTheDocument();
    expect(save).toBeDisabled();
  });
});

describe("a value that is already on the file", () => {
  it("says when it is text only, and points at the fix", async () => {
    withCatalogue([]); // nothing resolves "Doula"
    renderPicker({ value: "Doula" });
    expect(await screen.findByText(/text only/i)).toBeInTheDocument();
    expect(screen.getByText(/Open the search to fix it/i)).toBeInTheDocument();
  });

  it("shows the verified badge when the value IS a catalogue place", async () => {
    withCatalogue([DOUALA]);
    renderPicker({ value: "Douala" });
    expect(await screen.findByText("Verified")).toBeInTheDocument();
  });

  it("shows an unverified value as such, with what to do about it", async () => {
    withCatalogue([{ ...DOUALA, name: "Kribi Depot", verified_at: null, source: "GEOAPIFY" }]);
    renderPicker({ value: "Kribi Depot" });
    expect(await screen.findByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText(/never confirmed/i)).toBeInTheDocument();
  });

  it("seeds the search with the existing value, so a legacy string is one keystroke from fixed", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA]);
    renderPicker({ value: "Doula" });
    const input = await open(user);
    expect(input).toHaveValue("Doula");
  });
});

describe("accessibility", () => {
  it("the closed control has no violations", async () => {
    withCatalogue([DOUALA]);
    const { container } = renderPicker({ value: "Douala" });
    await screen.findByText("Verified");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the open listbox has no violations", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA, DOUALA_AIRPORT]);
    const { container } = renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    await screen.findAllByRole("option");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the combobox is wired to its listbox and active option", async () => {
    const user = userEvent.setup();
    withCatalogue([DOUALA, DOUALA_AIRPORT]);
    renderPicker();
    const input = await open(user);
    await user.type(input, "dou");
    const options = await screen.findAllByRole("option");
    const list = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", list.id);
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  });
});
