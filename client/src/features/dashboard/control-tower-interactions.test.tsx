/**
 * The Control Tower as a tool rather than a picture: selecting a file, reading it
 * on hover and on focus, driving it from the keyboard, and the two modes a meeting
 * uses.
 *
 * WHY THESE AND NOT MORE RENDER ASSERTIONS. `control-tower.test.tsx` already
 * proves the components render and pass axe. What was missing was any proof that
 * the interactions exist at all — and they are the whole difference between the
 * previous tower and this one. Each test below is a sentence an operator would
 * say: "click a route and I see its legs", "arrow through the files without a
 * mouse", "Escape gets me out".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DashboardPage } from "./index";
import { ItineraryPanel } from "./components/itinerary-panel";
import { LANE_STROKE } from "./map/shipment-map";
import { MODE_GLYPH } from "./mode-icons";
import { OperationalActivityPanel } from "./components/operational-activity-panel";
import type { ActivityRecord, ItineraryLeg, LiveShipment } from "./model";

/** A leg as the API projects it: text under `origin`, the resolved point under
 *  `origin_endpoint`, so a leg can be read and written back unchanged. */
const leg = (over: Record<string, unknown> = {}) => ({
  itinerary_leg_id: "leg-1",
  seq: 1,
  leg_type: "MAIN_CARRIAGE",
  mode: "SEA",
  status: "IN_PROGRESS",
  is_optional: false,
  source: "TEMPLATE",
  planned_departure: "2026-07-01",
  planned_arrival: "2026-07-20",
  actual_departure: null,
  actual_arrival: null,
  provider_id: null,
  provider_name: "Maersk",
  notes: null,
  origin: "Shanghai",
  destination: "Douala",
  origin_endpoint: {
    name: "Shanghai",
    latitude: 31.2292,
    longitude: 121.4744,
    kind: "SEAPORT",
    state: "verified",
  },
  destination_endpoint: {
    name: "Douala",
    latitude: 4.0482,
    longitude: 9.7004,
    kind: "SEAPORT",
    state: "verified",
  },
  plottable: true,
  needs_location: false,
  ...over,
});

const SEA_FILE = {
  dossier_id: "d-142",
  ref: "SBX-OPS-2026-0142",
  status: "IN_PROGRESS",
  origin: "Shanghai",
  destination: "Douala",
  service_key: "SEA_FREIGHT_IMPORT",
  service_name: "Sea freight import",
  mode: "SEA",
  is_movement: true,
  needs_location: false,
  eta: "2026-07-20",
  current_milestone: "Costing approval",
  progress: 55,
  milestone_total: 9,
  milestone_done: 5,
  legs: [
    leg(),
    leg({
      itinerary_leg_id: "leg-2",
      seq: 2,
      leg_type: "FINAL_DELIVERY",
      mode: "LAND",
      status: "PLANNED",
      source: "MANUAL",
      origin: "Douala",
      destination: "Yaoundé",
      origin_endpoint: {
        name: "Douala",
        latitude: 4.0482,
        longitude: 9.7004,
        kind: "SEAPORT",
        state: "verified",
      },
      destination_endpoint: {
        name: "Yaoundé",
        latitude: 3.848,
        longitude: 11.5021,
        kind: "CITY",
        state: "reference",
      },
    }),
  ],
  coords: {
    from: {
      name: "Shanghai",
      latitude: 31.2292,
      longitude: 121.4744,
      state: "verified",
    },
    to: {
      name: "Douala",
      latitude: 4.0482,
      longitude: 9.7004,
      state: "verified",
    },
  },
};

const AIR_FILE = {
  dossier_id: "d-200",
  ref: "SBX-OPS-2026-0200",
  status: "OPEN",
  origin: "Paris CDG",
  destination: "Douala Airport",
  service_key: "AIR_FREIGHT_IMPORT",
  service_name: "Air freight import",
  mode: "AIR",
  is_movement: true,
  needs_location: false,
  legs: [
    leg({
      itinerary_leg_id: "leg-air",
      mode: "AIR",
      origin: "Paris CDG",
      destination: "Douala Airport",
      origin_endpoint: {
        name: "Paris CDG",
        latitude: 49.0097,
        longitude: 2.5479,
        kind: "AIRPORT",
        state: "verified",
      },
      destination_endpoint: {
        name: "Douala Airport",
        latitude: 4.0061,
        longitude: 9.7195,
        kind: "AIRPORT",
        state: "verified",
      },
    }),
  ],
  coords: null,
};

/** A warehousing file: real work, no route. */
const WAREHOUSE_FILE = {
  dossier_id: "d-300",
  ref: "SBX-OPS-2026-0300",
  status: "OPEN",
  origin: null,
  destination: null,
  service_key: "WAREHOUSING",
  service_name: "Warehousing",
  mode: "OTHER",
  is_movement: false,
  needs_location: false,
  legs: [],
  coords: null,
};

/** A movement file naming a place nobody verified — must NOT be drawn. */
const UNRESOLVED_FILE = {
  dossier_id: "d-400",
  ref: "SBX-OPS-2026-0400",
  status: "OPEN",
  origin: "Doula",
  destination: "Garoua",
  service_key: "HINTERLAND_TRANSIT",
  service_name: "Hinterland transit",
  mode: "LAND",
  is_movement: true,
  needs_location: true,
  legs: [],
  coords: null,
};

const tower = (shipments: unknown[], over: Record<string, unknown> = {}) => ({
  operation_files: {
    active: shipments.length,
    open: shipments.length,
    in_progress: 0,
    movement: shipments.filter(
      (s) => (s as Record<string, unknown>).is_movement,
    ).length,
    activity: shipments.filter(
      (s) => !(s as Record<string, unknown>).is_movement,
    ).length,
    needs_location: shipments.filter(
      (s) => (s as Record<string, unknown>).needs_location,
    ).length,
    ...(over.operation_files as Record<string, unknown>),
  },
  approvals_awaiting: 2,
  page: { limit: 50, has_more: false, next_cursor: null },
  live_shipments: shipments,
});

function renderTower(shipments: unknown[] = [SEA_FILE, AIR_FILE]) {
  return renderScreen(<DashboardPage />, {
    routes: {
      "/dashboard/control-tower": tower(shipments),
      "/dashboard/kpis": { revenue_final_ttc: 1, revenue_currency: "XAF" },
      "/receivables/overdue": { total: 0 },
      "/tenant/audit/my-feed": [],
      "/service-types": [],
    },
  });
}

beforeEach(() => {
  fixtures.current = {};
});

describe("selecting a file", () => {
  it("clicking a row opens its itinerary beside the map", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );

    // The itinerary replaces the list in the right column: one column, not a
    // third one, because a tower that grows a panel per feature becomes the wall
    // of information this redesign exists to avoid.
    expect(
      await screen.findByRole("heading", { name: "SBX-OPS-2026-0142" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Main carriage")).toBeInTheDocument();
    expect(screen.getByText("Final delivery")).toBeInTheDocument();
  });

  it("the itinerary names both endpoints and flags a reference point", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    // Yaoundé is a reference point on the delivery leg — a verified place NEAR the
    // real address. Saying so is the difference between honest and precise.
    expect(await screen.findByText("Reference point")).toBeInTheDocument();
  });

  it("closing the itinerary brings the list back", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: /close itinerary/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Live shipments" }),
    ).toBeInTheDocument();
  });

  it("the map reports the selection", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    expect(await screen.findByText(/1 selected/)).toBeInTheDocument();
  });

  it("offers a way back to the whole picture", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    const clear = await screen.findByRole("button", {
      name: /clear selection/i,
    });
    await user.click(clear);
    expect(
      await screen.findByRole("heading", { name: "Live shipments" }),
    ).toBeInTheDocument();
  });
});

describe("the map's own semantics", () => {
  it("counts legs per mode, not files", async () => {
    renderTower();
    // Three plottable legs across two files: two sea/land on the sea file, one air.
    expect(
      await screen.findByRole("img", {
        name: /1 sea, 1 road and 1 air legs across 2 operation files/,
      }),
    ).toBeInTheDocument();
  });

  it("does not draw a file whose location is unverified", async () => {
    renderTower([UNRESOLVED_FILE]);
    // Nothing plottable, so the map says so rather than inventing a lane.
    expect(
      await screen.findByText(/need a verified origin and destination/),
    ).toBeInTheDocument();
  });

  it("is one keyboard stop with arrows inside it", async () => {
    renderTower();
    const widget = await screen.findByRole("application");
    expect(widget).toHaveAttribute("tabindex", "0");
    expect(widget).toHaveAccessibleName(/arrow keys/i);
  });

  it("arrowing through routes shows each file's card without selecting it", async () => {
    const user = userEvent.setup();
    renderTower();
    const widget = await screen.findByRole("application");
    widget.focus();
    await user.keyboard("{ArrowRight}");
    // The hover card renders on FOCUS too — information available on hover alone
    // is information a keyboard user does not have (WCAG §1.4.13).
    await waitFor(() =>
      expect(screen.getByText("Costing approval")).toBeInTheDocument(),
    );
    // …and moving is not choosing: the list is still there.
    expect(
      screen.getByRole("heading", { name: "Live shipments" }),
    ).toBeInTheDocument();
  });

  it("Enter on the focused route selects it", async () => {
    const user = userEvent.setup();
    renderTower();
    const widget = await screen.findByRole("application");
    widget.focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(
      await screen.findByRole("heading", { name: "SBX-OPS-2026-0142" }),
    ).toBeInTheDocument();
  });

  it("Escape clears the selection", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    await screen.findByRole("heading", { name: "SBX-OPS-2026-0142" });
    await user.keyboard("{Escape}");
    expect(
      await screen.findByRole("heading", { name: "Live shipments" }),
    ).toBeInTheDocument();
  });

  /**
   * Sea GREEN, air BLUE, road ORANGE, from three declared tokens.
   *
   * Sea used to be `--brand-blue-bright` and air `--brand-blue` — the same hue two
   * steps apart, which on a 2px dashed line is not a distinction at all: on the
   * deployed map a vessel leg and a flight leg drew as one colour. Road was
   * `--primary`, the TENANT'S accent, so a tenant with a blue brand would have lost
   * road onto air as well and the legend would have been naming three colours the
   * map drew as two.
   *
   * Pinned as a set rather than one assertion per mode, because the property that
   * matters is that the three are DIFFERENT and none of them is brand-dependent.
   */
  it("draws the three modes in three distinct, non-brand colours", async () => {
    renderTower();
    await screen.findByRole("application");
    expect(LANE_STROKE.sea).toBe("rgb(var(--mode-sea))");
    expect(LANE_STROKE.air).toBe("rgb(var(--mode-air))");
    expect(LANE_STROKE.road).toBe("rgb(var(--mode-road))");
    const routes = [LANE_STROKE.sea, LANE_STROKE.air, LANE_STROKE.road];
    expect(new Set(routes).size).toBe(3);
    // Nothing on a route reads the brand or the tenant accent any more.
    expect(routes.join(" ")).not.toMatch(/--primary|--brand-/);
  });

  it("draws a mode glyph on each lane, not an anonymous dot", async () => {
    // A ship on a vessel leg, a plane on a flight, a truck on a road leg — and
    // turned along the path, so the marker also shows the direction of travel.
    const { container } = renderTower();
    await screen.findByRole("application");
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBeGreaterThan(0);
    motions.forEach((m) => {
      const marker = m.parentElement!;
      const glyph = marker.querySelector("path");
      expect(glyph).not.toBeNull();
      // The glyph is FILLED with the lane's own mode colour, and the four mode
      // paths are the only things it may be.
      expect(glyph!.getAttribute("fill")).toMatch(/var\(--mode-|var\(--ink\)/);
      expect(Object.values(MODE_GLYPH)).toContain(glyph!.getAttribute("d"));
    });
  });

  it("shapes each endpoint by what kind of place it is", async () => {
    const { container } = renderTower();
    await screen.findByRole("application");
    // Douala and Kribi are seaports in the fixtures, Paris CDG an airport, so the
    // map must carry both a ship and a plane among its fixed markers.
    const shapes = [...container.querySelectorAll("path[transform]")].map((n) =>
      n.getAttribute("d"),
    );
    expect(shapes).toContain(MODE_GLYPH.sea);
    expect(shapes).toContain(MODE_GLYPH.air);
  });
});

describe("full screen", () => {
  it("enters and exits, and says which state it is in", async () => {
    const user = userEvent.setup();
    renderTower();
    const enter = await screen.findByRole("button", { name: "Full screen" });
    expect(enter).toHaveAttribute("aria-pressed", "false");
    await user.click(enter);

    const dialog = await screen.findByRole("dialog", { name: /full screen/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The legend survives, because full screen is where somebody who has never
    // seen the screen is reading it over a shoulder.
    expect(
      within(dialog).getByRole("img", { name: /Live shipment map/ }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Exit full screen" }),
    );
    expect(
      screen.queryByRole("dialog", { name: /full screen/i }),
    ).not.toBeInTheDocument();
  });

  it("Escape leaves full screen before it clears the selection", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /SBX-OPS-2026-0142/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Full screen" }),
    );
    await screen.findByRole("dialog", { name: /full screen/i });

    await user.keyboard("{Escape}");
    // Out of full screen, selection intact — the mode entered last is the one left.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /full screen/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: "SBX-OPS-2026-0142" }),
    ).toBeInTheDocument();
  });
});

/**
 * Both overlays are meant to cover the whole application except the title bar, and
 * to FIT — and the deployed build did neither.
 *
 * They were `fixed inset-0 z-50`, which is above the ribbon's `z-30` and the title
 * bar's `z-40` on paper. On screen the ribbon painted over them, clipping the
 * heading and the exit button behind the nav tabs, because `z-index` only orders
 * siblings within a STACKING CONTEXT and these were rendered deep inside the
 * scrolling content region — whose own ancestor establishes one. No z-index could
 * have escaped it; the fix is to portal out to `document.body`.
 *
 * The map then overflowed the bottom of the screen, because its `<svg>` was
 * `h-auto w-full` and so derived a height from the full viewport width. On the
 * deployed map the southern half of the world was cut off with Rio de Janeiro's
 * label on the very edge.
 */
describe("the overlays cover the app and fit inside it", () => {
  const overlays: [string, RegExp, RegExp][] = [
    ["full screen", /^Full screen$/, /full screen/i],
    ["meeting view", /meeting view/i, /operations meeting/i],
  ];

  it.each(overlays)(
    "%s renders at the document root, not inside the page",
    async (_name, open, dialogName) => {
      const user = userEvent.setup();
      const { container } = renderTower();
      await user.click(await screen.findByRole("button", { name: open }));
      const dialog = await screen.findByRole("dialog", { name: dialogName });

      // Portalled: outside the rendered tree, directly under <body>.
      expect(container.contains(dialog)).toBe(false);
      expect(dialog.parentElement).toBe(document.body);
    },
  );

  it.each(overlays)(
    "%s starts below the title bar and covers the rest",
    async (_name, open, dialogName) => {
      const user = userEvent.setup();
      renderTower();
      await user.click(await screen.findByRole("button", { name: open }));
      const dialog = await screen.findByRole("dialog", { name: dialogName });

      // Geometry, not z-order. The title bar is the draggable window region in the
      // desktop build and carries the window controls, so an overlay across it leaves
      // no way to move or close the window.
      expect(dialog.style.top).toBe("var(--titlebar-h)");
      expect(dialog.className).toMatch(/\bfixed\b/);
      expect(dialog.className).toMatch(/\bbottom-0\b/);
      expect(dialog.className).toMatch(/\bleft-0\b/);
      expect(dialog.className).toMatch(/\bright-0\b/);
      // Above the ribbon (z-30) and the title bar's own strip (z-40).
      expect(dialog.className).toMatch(/z-\[55\]/);
    },
  );

  it.each(overlays)(
    "%s makes the map fit its box instead of overflowing",
    async (_name, open, dialogName) => {
      const user = userEvent.setup();
      renderTower();
      await user.click(await screen.findByRole("button", { name: open }));
      const dialog = await screen.findByRole("dialog", { name: dialogName });

      const svg = within(dialog).getByRole("img", {
        name: /Live shipment map/,
      });
      // `h-full` + "meet" letterboxes the map into whatever height is left. `h-auto`
      // is what computed a height from the viewport width and ran off the bottom.
      expect(svg.getAttribute("class")).toMatch(/\bh-full\b/);
      expect(svg.getAttribute("class")).not.toMatch(/\bh-auto\b/);
      expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    },
  );

  it.each(overlays)(
    "%s stops the page behind it scrolling, and restores it",
    async (_name, open, dialogName) => {
      const user = userEvent.setup();
      renderTower();
      await user.click(await screen.findByRole("button", { name: open }));
      await screen.findByRole("dialog", { name: dialogName });
      expect(document.body.style.overflow).toBe("hidden");

      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: dialogName }),
        ).not.toBeInTheDocument(),
      );
      // Restored, not left locked — an overlay that forgets this leaves the whole app
      // unscrollable until a reload.
      expect(document.body.style.overflow).not.toBe("hidden");
    },
  );

  it("the dashboard card still sizes itself from its width", async () => {
    // The other half of the same change: outside an overlay the map has no box to
    // fit, so it must keep deriving its height from the viewBox or the card
    // collapses to nothing.
    renderTower();
    const svg = await screen.findByRole("img", { name: /Live shipment map/ });
    expect(svg.getAttribute("class")).toMatch(/\bh-auto\b/);
  });
});

describe("meeting view", () => {
  it("opens with the numbers a meeting starts on", async () => {
    const user = userEvent.setup();
    renderTower([SEA_FILE, AIR_FILE, WAREHOUSE_FILE, UNRESOLVED_FILE]);
    await user.click(
      await screen.findByRole("button", { name: /meeting view/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: /operations meeting/i,
    });
    expect(within(dialog).getByText("Active files")).toBeInTheDocument();
    expect(within(dialog).getByText("Need a location")).toBeInTheDocument();
    // The stat counts FILES at a facility; the legend below counts the same
    // files as "facility only". Two numbers, two labels — the same words on both
    // would read as one figure disagreeing with itself.
    expect(within(dialog).getByText("At a facility")).toBeInTheDocument();
    expect(within(dialog).getByText(/facility only/)).toBeInTheDocument();
    // Read-only is stated, not implied: the person driving a projector is talking,
    // not watching their cursor.
    expect(within(dialog).getByText("Read-only view")).toBeInTheDocument();
  });

  it("says what is filtered, so the room knows what it is looking at", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /meeting view/i }),
    );
    expect(
      await screen.findByText("All open operation files"),
    ).toBeInTheDocument();
  });

  it("auto-refresh is off until asked for, and can be paused", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /meeting view/i }),
    );
    const toggle = await screen.findByRole("button", {
      name: /auto-refresh every 2 min/i,
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(
      await screen.findByRole("button", { name: /pause auto-refresh/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("Escape leaves", async () => {
    const user = userEvent.setup();
    renderTower();
    await user.click(
      await screen.findByRole("button", { name: /meeting view/i }),
    );
    await screen.findByRole("dialog", { name: /operations meeting/i });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /operations meeting/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = renderTower();
    await user.click(
      await screen.findByRole("button", { name: /meeting view/i }),
    );
    await screen.findByRole("dialog", { name: /operations meeting/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("what is not on the map", () => {
  it("lists facility work and unverified locations, exceptions first", async () => {
    renderTower([SEA_FILE, WAREHOUSE_FILE, UNRESOLVED_FILE]);
    // Scoped to the panel's own landmark: both files also appear in the live
    // shipments list above it, so an unscoped query reads the wrong panel's order.
    const panel = await screen.findByRole("region", { name: "Not on the map" });
    expect(await within(panel).findByText("1 to fix")).toBeInTheDocument();
    // The unresolved file is an exception to fix; the warehouse is a note.
    const rows = within(panel).getAllByRole("button", {
      name: /SBX-OPS-2026-0(300|400)/,
    });
    expect(rows[0]).toHaveAccessibleName(/0400/);
  });

  it("is absent when everything is drawable", async () => {
    renderTower([SEA_FILE]);
    await screen.findByRole("heading", { name: "Live shipments" });
    expect(
      screen.queryByRole("region", { name: "Not on the map" }),
    ).not.toBeInTheDocument();
  });

  it("selecting from it opens the same itinerary panel", async () => {
    const user = userEvent.setup();
    renderTower([SEA_FILE, WAREHOUSE_FILE]);
    const panel = await screen.findByRole("region", { name: "Not on the map" });
    await user.click(
      within(panel).getByRole("button", { name: /SBX-OPS-2026-0300/ }),
    );
    expect(
      await screen.findByRole("region", {
        name: /Itinerary for SBX-OPS-2026-0300/,
      }),
    ).toBeInTheDocument();
  });
});

/* ── the panels in isolation, for the states a full page cannot easily reach ── */

const SHIPMENT: LiveShipment = {
  dossierId: "d-1",
  ref: "REF-1",
  serviceName: "Sea freight import",
  isMovement: true,
  needsLocation: false,
  mode: "sea",
  from: "Shanghai",
  to: "Douala",
  status: "In progress",
  tone: "blue",
  stage: "Costing approval",
  eta: "20 Jul 2026",
  progress: 55,
};

const legModel = (over: Partial<ItineraryLeg> = {}): ItineraryLeg => ({
  id: "l1",
  seq: 1,
  legType: "MAIN_CARRIAGE",
  mode: "sea",
  status: "PLANNED",
  isOptional: false,
  source: "TEMPLATE",
  plannedDeparture: null,
  plannedArrival: null,
  actualDeparture: null,
  actualArrival: null,
  providerName: null,
  notes: null,
  origin: { name: "Shanghai", state: "verified" },
  destination: { name: "Douala", state: "verified" },
  plottable: true,
  needsLocation: false,
  ...over,
});

describe("ItineraryPanel", () => {
  const wrap = (ui: React.ReactNode) => renderScreen(<>{ui}</>, { routes: {} });

  it("says when a leg cannot be drawn, and why", () => {
    wrap(
      <ItineraryPanel
        shipment={SHIPMENT}
        legs={[
          legModel({
            needsLocation: true,
            plottable: false,
            destination: { name: null },
          }),
        ]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/no verified location, so/)).toBeInTheDocument();
    expect(screen.getByText(/not drawn on the map/)).toBeInTheDocument();
  });

  it("explains an empty itinerary rather than showing a blank panel", () => {
    wrap(<ItineraryPanel shipment={SHIPMENT} legs={[]} onClose={vi.fn()} />);
    expect(screen.getByText("No structured itinerary")).toBeInTheDocument();
  });

  it("deep-links to the file by id, not only by its display ref", () => {
    wrap(
      <ItineraryPanel
        shipment={SHIPMENT}
        legs={[legModel()]}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /open the operations file/i }),
    ).toHaveAttribute("href", "/operations/files?ref=REF-1&focus=d-1");
  });

  it("shows actual dates in preference to planned ones", () => {
    wrap(
      <ItineraryPanel
        shipment={SHIPMENT}
        legs={[
          legModel({
            plannedDeparture: "2026-07-01",
            actualDeparture: "2026-07-04",
          }),
        ]}
        onClose={vi.fn()}
      />,
    );
    // "Left the 4th" is what happened; "due out the 1st" is what was hoped.
    expect(screen.getByText(/Left 04 Jul 2026/)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(
      <ItineraryPanel
        shipment={SHIPMENT}
        legs={[legModel()]}
        onClose={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("OperationalActivityPanel", () => {
  const record = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    dossierId: "d-9",
    ref: "REF-9",
    serviceName: "Warehousing",
    status: "Open",
    tone: "mute",
    stage: "",
    eta: "",
    reason: "activity",
    facility: null,
    ...over,
  });

  const wrap = (ui: React.ReactNode) => renderScreen(<>{ui}</>, { routes: {} });

  it("says everything is fine rather than rendering an empty box", () => {
    wrap(
      <OperationalActivityPanel
        records={[]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Everything is on the map")).toBeInTheDocument();
  });

  it("marks a row that needs a location as pressed when selected", () => {
    wrap(
      <OperationalActivityPanel
        records={[record({ reason: "needs-location" })]}
        selected="d-9"
        onSelect={vi.fn()}
      />,
    );
    const row = screen.getByRole("button", { name: /REF-9/ });
    expect(row).toHaveAttribute("aria-pressed", "true");
    expect(row).toHaveTextContent("Needs a location");
  });

  it("has no axe violations", async () => {
    const { container } = wrap(
      <OperationalActivityPanel
        records={[
          record(),
          record({
            dossierId: "d-10",
            ref: "REF-10",
            reason: "needs-location",
          }),
        ]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
