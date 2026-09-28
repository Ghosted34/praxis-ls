/**
 * Warehouse location 360 → the list tiles open the rows they count, and the
 * pages those rows land on honour `?focus=`.
 *
 * Pinned: the tiles show the slot's own counts from the server (never the rows
 * one page happens to hold); each tab and drill-in asks for THIS slot
 * (`?location_id=`) and pages through the server's total; On hand ranks by
 * quantity; Capacity used is a percentage and stays inert; a row lands on
 * Inventory focused on the item, which opens it, and on the Equipment board
 * focused on the card, which is ringed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";
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
beforeEach(() => {
  paged = [];
  vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    paged.push(path);
    const q = new URLSearchParams(path.split("?")[1]);
    const loc = q.get("location_id");
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
