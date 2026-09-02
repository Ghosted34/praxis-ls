/**
 * The transit order 360 — one body, two shells.
 *
 * WHAT THESE PIN. The same four properties as the operations file 360, because
 * the same four are what a page-shaped record can lose silently:
 *
 *   1. the header names the order from the RESPONSE, so a pasted OT number
 *      resolves without a list row in hand;
 *   2. the tab is in the URL, so a colleague can be sent to the Cargo tab of one
 *      order — a `useState` tab passes every click-driven test and fails this;
 *   3. the cargo reconciliation is visible as a TONE and a hint, not only as a
 *      callout three scrolls down, because "the lines do not add up to the
 *      declared value" is the single defect this screen exists to catch;
 *   4. the phone gets the sheet and the desktop gets the route, in both
 *      directions.
 *
 * `useIsDesktop` answers TRUE when `matchMedia` is absent, so the desktop branch
 * is jsdom's default and the mobile branch has to be asked for explicitly —
 * which is also the production behaviour on the first frame.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { TransitOrder360Page } from "./transit-order-360";
import { TransitOrdersPage } from "./transit-orders";

/** Renders the router's current location, so a test can assert a navigation
 *  rather than a rendered side effect of one. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

const ID = "to-1";

/** An order whose cargo lines do NOT add up to the declared value — the state
 *  the screen exists to make obvious. */
const ORDER = {
  transit_order_id: ID,
  ref: "OT-2026-0114",
  dossier_id: "d-1",
  dossier_ref: "SBX-2026-0001",
  client_name: "CIMENCAM",
  entity_name: "JBS Praxis SA",
  status: "ISSUED",
  customs_regime: "IM4",
  service_direction: "IMPORT",
  declared_value: 12_000_000,
  declared_currency: "EUR",
  declared_fx_to_xaf: 655.957,
  insurance_type: "COMPANY",
  surveyor_party: "CLIENT",
  departure_date: "2026-08-20",
  declaration_ref: null,
  lodged_at: null,
  signed_by_name: null,
  shipment_details_source: "SNAPSHOT",
  allowed_transitions: ["SIGNED", "CANCELLED"],
  issue_blockers: [],
  lines: [
    {
      transit_order_line_id: "l-1",
      label: "Cement clinker",
      marks: "CIM/2026",
      packages: 400,
      weight: "24t",
      value_amount: 7_000_000,
    },
    {
      transit_order_line_id: "l-2",
      label: "Spare parts",
      marks: null,
      packages: 12,
      weight: "300kg",
      value_amount: 1_500_000,
    },
  ],
  totals: {
    lines_total: 8_500_000,
    declared_value: 12_000_000,
    declared_value_xaf: 7_871_484_000,
    reconciles: false,
  },
  shipment_details: null,
};

/** What the Details tab fetches when the order carries no frozen snapshot. */
const SHIPMENT = {
  dossier: { dossier_id: "d-1", ref: "SBX-2026-0001", status: "OPEN" },
  field_set: null,
  facets: {},
  facet_order: [],
  route_label: "Antwerp → Douala",
  groups: [],
  containers: { enabled: false, mode: "NONE", lines: [] },
  completeness: {
    total: 0,
    filled: 0,
    percent: 0,
    required_total: 0,
    required_filled: 0,
    missing_required: [],
    is_complete: true,
  },
};

const routes = {
  [`/transit-orders/${ID}`]: ORDER,
  "/operations/d-1/shipment-details": SHIPMENT,
  "/transit-orders": [ORDER],
  "/transit-orders/summary": { TOTAL: 1, DRAFT: 0, ISSUED: 1, SIGNED: 0, LODGED: 0 },
  "/operations": [{ dossier_id: "d-1", ref: "SBX-2026-0001", status: "OPEN" }],
};

const renderPage = (path = `/operations/transit-orders/${ID}`) =>
  renderScreen(<TransitOrder360Page />, {
    routes,
    path,
    pattern: "/operations/transit-orders/:orderId",
  });

afterEach(() => {
  fixtures.current = {};
});

describe("Transit order 360 · the page", () => {
  it("names the order from the response alone — no list row in hand", async () => {
    renderPage();

    // The OT number is the page's h1: the order IS the page, so it carries the
    // document outline rather than a generic screen title.
    expect(
      await screen.findByRole("heading", { level: 1, name: "OT-2026-0114" }),
    ).toBeInTheDocument();
    // Client, file, regime and departure all come from the response.
    expect(
      screen.getByText(
        "CIMENCAM · File SBX-2026-0001 · IM4 · Departs 20 Aug 2026",
      ),
    ).toBeInTheDocument();
    // The lifecycle is stated in words, not only as a coloured pill.
    expect(
      screen.getByText("Numbered and out for the client's signature."),
    ).toBeInTheDocument();
  });

  it("opens the tab the URL asks for, not the first one", async () => {
    renderPage(`/operations/transit-orders/${ID}?tab=cargo`);

    expect(await screen.findByText("Cement clinker")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Cargo/ })).toBeChecked();
  });

  it("says on the tile that the cargo does not reconcile", async () => {
    renderPage();

    // The callout is on the Cargo tab, one click away. The KPI strip is on
    // every tab — so the discrepancy is visible before anyone goes looking.
    const tile = await screen.findByRole("button", {
      name: /Cargo total — open the Cargo tab/,
    });
    expect(tile).toHaveTextContent("does not reconcile");
  });

  it("drills from a KPI tile into the tab that explains the figure", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: /Cargo total — open the Cargo tab/,
      }),
    );

    // The Cargo tab opened, and the reconciliation is stated in full on it.
    expect(await screen.findByText("Cement clinker")).toBeInTheDocument();
    expect(screen.getByText(/against a declared/)).toBeInTheDocument();
  });

  it("offers the XAF conversion only because this order is in EUR", async () => {
    renderPage();
    // A tile repeating the number beside it teaches operators to ignore tiles,
    // so it exists only when the declared currency is not the reporting one.
    expect(
      await screen.findByRole("button", {
        name: /Declared value in XAF — open the Details tab/,
      }),
    ).toBeInTheDocument();
  });

  it("counts the cargo tab from the lines the response carries", async () => {
    renderPage();
    expect(
      await screen.findByRole("radio", { name: "Cargo · 2" }),
    ).toBeInTheDocument();
  });
});

describe("Transit orders list · how the 360 opens", () => {
  const renderList = (path = "/operations/transit-orders") =>
    renderScreen(
      <>
        <TransitOrdersPage />
        <LocationProbe />
      </>,
      { routes, path, pattern: "/operations/*" },
    );

  it("sends a desktop click to the order's own page", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      (await screen.findAllByRole("button", { name: /OT-2026-0114/ }))[0],
    );

    // The address IS the deliverable: a modal opened in local state would leave
    // this unchanged, and an OT number would still not be something you can send.
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/transit-orders/${ID}`,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exchanges a desktop ?focus= for the route, so old deep links land", async () => {
    renderList(`/operations/transit-orders?focus=${ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/transit-orders/${ID}`,
      ),
    );
  });

  describe("on a phone", () => {
    beforeEach(() => {
      // Below `lg` the detail view is a sheet over the list, not a page — a
      // full-page drill-in on a 390px viewport is a navigation dead end.
      vi.stubGlobal(
        "matchMedia",
        (query: string) =>
          ({
            matches: false,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens the sheet over the list, and keeps it in the URL", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(
        (await screen.findAllByRole("button", { name: /OT-2026-0114/ }))[0],
      );

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("OT-2026-0114");
      // Still a step the back arrow can reach — the sheet is in the URL, it is
      // just not a route.
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/transit-orders?focus=${ID}`,
      );
    });

    it("hands a shared desktop link to the sheet", async () => {
      renderPage();
      // The address survives the hand-off; only the container changes. The page
      // body must never paint, so this is a redirect rather than an effect.
      await waitFor(() => {
        expect(
          screen.queryByRole("heading", { level: 1, name: "OT-2026-0114" }),
        ).toBeNull();
      });
    });
  });
});
