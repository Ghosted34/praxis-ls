/**
 * Warehouse location 360 → the list tiles open the rows they count, and the
 * pages those rows land on honour `?focus=`.
 *
 * Pinned: the tiles show the slot's own counts from the server (never the rows
 * one page happens to hold); each tab and drill-in asks for THIS slot
 * (`?location_id=`) and pages through the server's total; On hand ranks by
 * quantity; Capacity used is a percentage and stays inert; a row lands on
 * Inventory focused on the item, which opens it, and on the Equipment board
 * focused on the card, which is ringed. And the rail itself: it reads the slots
 * a page at a time with the server's total, the search is the server's `?q=`
 * (so slot 117 of 120 can be found), and a slot the URL names off the current
 * page still opens, read by id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
  type RouteFixture,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";
import { locationLabel, type WarehouseLocation } from "@/lib/wms-api";
import { LocationsPage } from "./location-360";
import { InventoryPage } from "./inventory";
import { EquipmentPage } from "./equipment";

const LOCATIONS = [
  {
    location_id: "loc1",
    zone: "A",
    aisle: "01",
    rack: "R1",
    bin: "B1",
    capacity_units: 100_000,
  },
  {
    location_id: "loc2",
    zone: "B",
    aisle: "02",
    rack: "R1",
    bin: "B2",
    capacity_units: 100,
  },
];
const INVENTORY = [
  {
    inventory_item_id: "it1",
    sku: "SKU-SMALL",
    description: "Shrink wrap",
    qty_on_hand: 4,
    uom: "roll",
    state: "AVAILABLE",
    location_id: "loc1",
  },
  {
    inventory_item_id: "it2",
    sku: "SKU-BIG",
    description: "Pallets",
    qty_on_hand: 40,
    uom: "pc",
    state: "AVAILABLE",
    location_id: "loc1",
  },
  {
    inventory_item_id: "it3",
    sku: "SKU-ELSEWHERE",
    description: "Cartons",
    qty_on_hand: 90,
    uom: "pc",
    state: "AVAILABLE",
    location_id: "loc2",
  },
];
const EQUIPMENT = [
  {
    wms_equipment_id: "eq1",
    label: "Forklift FL-01",
    status: "AVAILABLE",
    location_id: "loc1",
  },
];
const ROUTES = {
  "/locations": LOCATIONS,
  // The slot's own stats, counted by the server over every row at it.
  "/locations/loc1": {
    ...LOCATIONS[0],
    stats: { items: 1234, on_hand: 56789, equipment: 1, cycle_counts: 0 },
  },
  "/inventory": INVENTORY,
  "/equipment": EQUIPMENT,
  "/cycle-counts": [],
};

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

/**
 * The paged reads the 360 makes, answered per slot: only `location_id=loc1`
 * rows come back, with a TOTAL far beyond what one page holds — the case the
 * old in-browser filter got wrong, because it only ever saw the tenant's first
 * 50 lines.
 */
let paged: string[] = [];
/** The slots the server holds — the rail reads them a page at a time. */
let slots: WarehouseLocation[] = LOCATIONS;
beforeEach(() => {
  paged = [];
  slots = LOCATIONS;
  vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    paged.push(path);
    const q = new URLSearchParams(path.split("?")[1]);
    const loc = q.get("location_id");
    if (path.startsWith("/locations?")) {
      // The server's search: the label the rail shows, anywhere in it.
      const needle = (q.get("q") || "").toLowerCase();
      const limit = Number(q.get("limit"));
      const offset = Number(q.get("offset"));
      const hits = slots.filter((l) =>
        locationLabel(l).toLowerCase().includes(needle),
      );
      return {
        data: hits.slice(offset, offset + limit),
        total: hits.length,
        limit,
        offset,
        hasMore: offset + limit < hits.length,
        meta: null,
      };
    }
    if (path.startsWith("/inventory")) {
      const rows = INVENTORY.filter((i) => i.location_id === loc);
      const sorted =
        q.get("sort") === "-qty_on_hand"
          ? [...rows].sort((a, b) => b.qty_on_hand - a.qty_on_hand)
          : rows;
      return {
        data: sorted,
        total: 1234,
        limit: 20,
        offset: 0,
        hasMore: true,
        meta: null,
      };
    }
    if (path.startsWith("/equipment")) {
      return {
        data: EQUIPMENT.filter((e) => e.location_id === loc),
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
        meta: null,
      };
    }
    return {
      data: [],
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: false,
      meta: null,
    };
  }) as typeof apiClient.tenantPaged);
});
afterEach(() => vi.restoreAllMocks());

describe("Location 360 · the counts are the slot's own", () => {
  const mount = () =>
    renderScreen(
      <>
        <LocationsPage />
        <Where />
      </>,
      { routes: ROUTES, path: "/wms/locations" },
    );

  it("shows the server's counts, not the rows one page holds, and says the tab stopped short", async () => {
    mount();
    // 1,234 stock lines at this slot; the old screen counted whatever of them
    // happened to be in the tenant's first 50.
    const items = await screen.findByRole("button", {
      name: /^open items stored$/i,
    });
    expect(await within(items).findByText("1,234")).toBeInTheDocument();
    const onHand = screen.getByRole("button", { name: /^open on hand$/i });
    expect(within(onHand).getByText("56,789")).toBeInTheDocument();
    // Capacity is worked out from the server's on-hand sum.
    expect(screen.getByText("57%")).toBeInTheDocument();

    // The Inventory tab asked for THIS slot, and says it holds more than it shows.
    expect(await screen.findByText("SKU-BIG")).toBeInTheDocument();
    expect(screen.queryByText("SKU-ELSEWHERE")).toBeNull();
    expect(paged).toContain("/inventory?limit=200&offset=0&location_id=loc1");
    expect(screen.getByText(/Showing 2 of 1,234/)).toBeInTheDocument();
  });

  it("On hand pages this slot's stock by quantity, and leaves Capacity inert", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open on hand$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("SKU-BIG")).toBeInTheDocument();
    expect(paged).toContain(
      "/inventory?limit=20&offset=0&location_id=loc1&sort=-qty_on_hand",
    );
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("SKU-BIG");
    expect(rows[1]).toHaveTextContent("SKU-SMALL");
    expect(within(dialog).getByText(/of 1,234/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open capacity used/i }),
    ).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "SKU-BIG" }));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/wms/inventory?focus=it2",
      ),
    );
  });

  it("opens the equipment parked here and lands on its card", async () => {
    mount();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open equipment$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: "Forklift FL-01" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/wms/equipment?focus=eq1",
      ),
    );
    expect(
      paged.some(
        (p) => p.startsWith("/equipment?") && p.includes("location_id=loc1"),
      ),
    ).toBe(true);
  });
});

describe("the landing pages honour ?focus=", () => {
  it("Inventory opens the focused item", async () => {
    renderScreen(<InventoryPage />, {
      routes: ROUTES,
      path: "/wms/inventory?focus=it2",
    });
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getAllByText(/Pallets|SKU-BIG/).length,
    ).toBeGreaterThan(0);
  });

  it("Equipment rings the focused card", async () => {
    renderScreen(<EquipmentPage />, {
      routes: ROUTES,
      path: "/wms/equipment?focus=eq1",
    });
    const card = (await screen.findByText("Forklift FL-01")).closest(
      "[data-row-key]",
    );
    expect(card).toHaveAttribute("data-row-key", "eq1");
    expect(card?.className).toMatch(/ring-2/);
  });
});

describe("the Locations rail is searched and paged on the server", () => {
  /**
   * 120 slots — more than one page of the rail, which is 50. Each carries the
   * `label` the server's list adds (warehouse_location.rules), which is the
   * text the rail shows and the text `?q=` searches.
   */
  const MANY: WarehouseLocation[] = Array.from({ length: 120 }, (_, i) => {
    const aisle = String(i + 1).padStart(3, "0");
    return {
      location_id: `s${i + 1}`,
      zone: "C",
      aisle,
      rack: "R1",
      bin: "B1",
      label: `C-${aisle}-R1-B1`,
      capacity_units: 10,
    };
  });
  const mount = (
    path = "/wms/locations",
    routes: Record<string, RouteFixture> = ROUTES,
  ) =>
    renderScreen(
      <>
        <LocationsPage />
        <Where />
      </>,
      { routes, path },
    );

  it("reads one page, says how many there are, and pages to the next", async () => {
    slots = MANY;
    mount();
    expect(await screen.findByText("C-001-R1-B1")).toBeInTheDocument();
    expect(paged).toContain("/locations?limit=50&offset=0");
    // The old rail stopped at slot 50 and said nothing.
    expect(screen.queryByText("C-051-R1-B1")).toBeNull();
    expect(screen.getByText("Showing 1–50 of 120")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("C-051-R1-B1")).toBeInTheDocument();
    expect(paged).toContain("/locations?limit=50&offset=50");
    expect(screen.getByText("Showing 51–100 of 120")).toBeInTheDocument();
  });

  it("asks the server for the search — a slot past the first page is found", async () => {
    slots = MANY;
    mount();
    await screen.findByText("C-001-R1-B1");
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Search slots" }),
      "C-117",
    );
    expect(await screen.findByText("C-117-R1-B1")).toBeInTheDocument();
    // Debounced: one request for the settled term, from its first page.
    expect(paged.filter((p) => p.includes("q="))).toEqual([
      "/locations?limit=50&offset=0&q=C-117",
    ]);
    // The rail holds only what matched. (Slot C-001, opened on arrival, stays
    // open in the detail pane — a search is not a reason to close it.)
    expect(screen.queryByRole("button", { name: "C-001-R1-B1" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "C-001-R1-B1" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Search slots" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search slots" }),
      "Z-9",
    );
    expect(
      await screen.findByText("No slot matches “Z-9”."),
    ).toBeInTheDocument();
  });

  it("opens a slot the URL names even when it is not on the page the rail holds", async () => {
    slots = MANY;
    const far = MANY[99];
    mount("/wms/locations?focus=s100", {
      ...ROUTES,
      "/locations/s100": {
        ...far,
        stats: { items: 7, on_hand: 3, equipment: 0, cycle_counts: 0 },
      },
    });
    // Not in the rail's first page…
    await screen.findByRole("button", { name: "C-001-R1-B1" });
    expect(screen.queryByRole("button", { name: "C-100-R1-B1" })).toBeNull();
    // …but its detail is open, read by id.
    const items = await screen.findByRole("button", {
      name: /^open items stored$/i,
    });
    expect(await within(items).findByText("7")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("focus=s100");
  });
});
