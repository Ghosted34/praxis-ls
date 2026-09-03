/**
 * The operations file 360 — one body, two shells.
 *
 * WHAT THESE PIN, and why each one is a defect waiting to happen.
 *
 * 1. THE PAGE NAMES THE FILE FROM THE RESPONSE ALONE. The 360 used to be handed
 *    the list row it was opened from, which is how it knew the client name and
 *    the service label. A page reached from a pasted link has no row. If the
 *    `/360` response ever stops carrying the display fields, the regression is
 *    silent — a header reading "SBX-2026-0001 · undefined" still renders — so it
 *    is asserted here rather than left to be noticed in Douala.
 *
 * 2. THE TAB IS IN THE URL. The point of the route is that a colleague can be
 *    sent to a file's Money tab. A `useState` tab would still pass a test that
 *    only clicked, so the deep link is tested from the URL in.
 *
 * 3. THE TAB COUNTS ARE THE TRUE COUNTS. `document_rows` is capped at 20 by the
 *    API. Counting it is a number that is right until a busy file makes it
 *    quietly wrong, so the strip reads the counts the response carries.
 *
 * 4. THE PHONE GETS THE SHEET. `useIsDesktop` answers TRUE when `matchMedia` is
 *    absent, so the desktop branch is the default in jsdom and the mobile branch
 *    has to be asked for explicitly — which is also the production behaviour on
 *    the first frame.
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

import { OperationFile360Page } from "./file-360";
import { OperationsFilesPage } from "./operation-files";

/** Renders the router's current location, so a test can assert a navigation
 *  rather than a rendered side effect of one. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

const ID = "d-1";

/** The 360 response, carrying the display fields the header renders from. */
const OVERVIEW = {
  dossier: {
    dossier_id: ID,
    ref: "SBX-2026-0001",
    status: "IN_PROGRESS",
    client_id: "cl-9",
    service_type_id: "st-1",
    title: "Export of beer",
    incoterm: "CIF",
    bl_mawb: "MAEU123456",
    pol: "Antwerp",
    pod: "Douala",
    eta: "2026-08-14",
    client_name: "Brasseries du Cameroun SA",
    service_key: "SEA",
    service_name_en: "Sea Freight Import",
    rate_provider_name: "Maersk",
    milestone_total: 10,
    milestone_done: 4,
    current_milestone: "Arrivée port",
  },
  readiness: null,
  costing: { count: 1, planned_cost: 1_000_000 },
  costs: { actual_cost: 900_000, gl_entries: 7 },
  invoicing: {
    count: 2,
    invoiced_ttc: 95_700_000,
    billed_ttc: 95_700_000,
    outstanding: 12_300_000,
  },
  money: {
    service_ht: 1,
    planned_cost: 1_000_000,
    actual_cost: 900_000,
    dossier_margin: 100_000,
    margin_percent: 10,
    budget: { budget: 1_000_000, actual: 900_000, variance: 100_000 },
  },
  people: null,
  milestones: { DONE: 4, PENDING: 6 },
  procurement: { po_count: 0, po_total: 0 },
  // 24 documents in total, but `document_rows` below holds one of each: the
  // strip must read THESE, not the arrays.
  documents: {
    transit_orders: 3,
    delivery_notes: 5,
    vault: 12,
    invoices: 4,
  },
  queries: { count: 2, open: 1 },
  document_rows: { invoices: [], transit: [], delivery: [], vault: [] },
};

const FILE_ROW = {
  dossier_id: ID,
  ref: "SBX-2026-0001",
  status: "IN_PROGRESS",
  entity_id: "e-1",
};

const SHIPMENT = {
  dossier: { dossier_id: ID, ref: "SBX-2026-0001", status: "IN_PROGRESS" },
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
  [`/operations/${ID}`]: FILE_ROW,
  [`/operations/${ID}/360`]: OVERVIEW,
  [`/operations/${ID}/shipment-details`]: SHIPMENT,
};

const renderPage = (path = `/operations/files/${ID}`) =>
  renderScreen(<OperationFile360Page />, {
    routes,
    path,
    pattern: "/operations/files/:fileId",
  });

afterEach(() => {
  fixtures.current = {};
});

describe("Operations file 360 · the page", () => {
  it("names the file from the 360 response alone — no list row in hand", async () => {
    renderPage();

    // The reference is the page's h1: this IS the record, so it carries the
    // document outline rather than a generic screen title.
    expect(
      await screen.findByRole("heading", { level: 1, name: "SBX-2026-0001" }),
    ).toBeInTheDocument();
    // Client, route, ETA and BL all come from the response, not from a row the
    // caller passed in — one meta line, asserted whole. This is what fails if
    // the header ever goes back to carrying ids only. The transport-document
    // word is derived from `service_key` (sea → BL, air → MAWB, road → Waybill,
    // rail → CIM); the legacy hard-coded "BL / MAWB" said "we did not care".
    expect(
      screen.getByText(
        "Brasseries du Cameroun SA · Antwerp → Douala · ETA 14 Aug 2026 · BL MAEU123456",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Export of beer")).toBeInTheDocument();
    expect(screen.getByText("Sea Freight Import")).toBeInTheDocument();
  });

  it("says nothing about a dossier anywhere the operator can read it", async () => {
    const { container } = renderPage();
    await screen.findByRole("heading", { level: 1, name: "SBX-2026-0001" });
    // The tenants asked for the word to go from the English UI. It is still the
    // column name, the event key and the French translation — none of which a
    // reader of this page ever sees.
    expect(container.textContent).not.toMatch(/dossier/i);
  });

  it("opens the tab the URL asks for, not the first one", async () => {
    renderPage(`/operations/files/${ID}?tab=money`);

    // A tab held in React state would pass a click-driven test and fail this
    // one, which is the whole point of putting it in the URL.
    expect(await screen.findByText("Budget vs actual")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^Money$/ }),
    ).toBeChecked();
  });

  it("drills from a KPI tile into the tab that explains the figure", async () => {
    const user = userEvent.setup();
    renderPage();

    const tile = await screen.findByRole("button", {
      name: /Outstanding — open the Money tab/,
    });
    await user.click(tile);

    expect(await screen.findByText("Budget vs actual")).toBeInTheDocument();
  });

  it("counts tabs from the response, not from the capped row lists", async () => {
    renderPage();

    // 4 invoices + 3 transit + 5 delivery + 12 vault = 24, while every
    // `document_rows` array is empty. Counting the arrays would say "0" and the
    // tab would carry no count at all.
    expect(
      await screen.findByRole("radio", { name: "Documents · 24" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Milestones · 4/10" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Queries · 2" }),
    ).toBeInTheDocument();
  });

  it("offers the lifecycle step the file is actually at", async () => {
    renderPage();
    // IN_PROGRESS advances to COMPLETED, so the control says Complete. Acting on
    // the file you are reading is the reason the header carries actions at all.
    expect(
      await screen.findByRole("button", { name: /Complete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start$/ })).toBeNull();
  });

  /**
   * The costing card (12766). Before this, the one screen that told you a file
   * HAD a costing was the one place you could not open it: the reference was
   * plain text, and the status was the raw enum printed at the operator.
   */
  describe("the costing card", () => {
    const withCosting = {
      ...OVERVIEW,
      costing: {
        count: 1,
        planned_cost: 1_000_000,
        costing_id: "c-1",
        doc_number: "CST-2026-0043",
        status: "APPROVED_LOCKED",
      },
      people: {
        costing: {
          costing_id: "c-1",
          doc_number: "CST-2026-0043",
          status: "APPROVED_LOCKED",
          validator: { user_id: "u-2", name: "Jean Mballa" },
          // Somebody stood in. Crediting `validator` for their decision is a
          // Separation-of-Duties record that lies.
          validated_by: { user_id: "u-7", name: "Awa Njoya" },
          approver: { user_id: "u-3", name: "Paul Etoa" },
        },
        invoice: null,
      },
    };

    const renderPeople = () =>
      renderScreen(<OperationFile360Page />, {
        routes: { ...routes, [`/operations/${ID}/360`]: withCosting },
        path: `/operations/files/${ID}?tab=people`,
        pattern: "/operations/files/:fileId",
      });

    it("links the sheet, and says its status in words", async () => {
      renderPeople();
      const link = await screen.findByRole("link", { name: "CST-2026-0043" });
      expect(link).toHaveAttribute("href", "/costing/costing/c-1");
      // "Approved", never `APPROVED_LOCKED` — a machine status is not shown raw
      // anywhere an operator can read it (FRONTEND_GUIDE §5).
      expect(screen.getByText("Approved")).toBeInTheDocument();
      expect(screen.queryByText("APPROVED_LOCKED")).toBeNull();
    });

    it("credits whoever actually validated, not only whoever was asked to", async () => {
      renderPeople();
      await screen.findByRole("link", { name: "CST-2026-0043" });
      expect(screen.getByText("Validator")).toBeInTheDocument();
      expect(screen.getByText("Jean Mballa")).toBeInTheDocument();
      expect(screen.getByText("Validated by")).toBeInTheDocument();
      expect(screen.getByText("Awa Njoya")).toBeInTheDocument();
    });

    it("stays silent about the stand-in when there was none", async () => {
      renderScreen(<OperationFile360Page />, {
        routes: {
          ...routes,
          [`/operations/${ID}/360`]: {
            ...withCosting,
            people: {
              ...withCosting.people,
              costing: {
                ...withCosting.people.costing,
                validated_by: { user_id: "u-2", name: "Jean Mballa" },
              },
            },
          },
        },
        path: `/operations/files/${ID}?tab=people`,
        pattern: "/operations/files/:fileId",
      });
      await screen.findByRole("link", { name: "CST-2026-0043" });
      // The row is a DIFFERENCE, not a field. Rendering it when the validator
      // validated their own sheet is a duplicate line that reads as two people.
      expect(screen.queryByText("Validated by")).toBeNull();
    });
  });
});

describe("Operations file 360 · the phone", () => {
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

  it("hands a shared desktop link to the list, which opens it as a sheet", async () => {
    renderPage();

    // The address survives the hand-off; only the container changes. The page
    // body must never paint, so this is a redirect rather than an effect.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { level: 1, name: "SBX-2026-0001" }),
      ).toBeNull();
    });
  });
});

/**
 * The list's half of the branch. The 360 is one component either way; what
 * changes is how you get to it, and that decision lives in the list.
 */
describe("Operations files list · how the 360 opens", () => {
  const LIST = [
    {
      dossier_id: ID,
      ref: "SBX-2026-0001",
      status: "IN_PROGRESS",
      client_name: "Brasseries du Cameroun SA",
      service_name_en: "Sea Freight Import",
      pol: "Antwerp",
      pod: "Douala",
      milestone_total: 10,
      milestone_done: 4,
    },
  ];
  const listRoutes = { ...routes, "/operations": LIST, "/service-types": [] };

  const renderList = (path = "/operations/files") =>
    renderScreen(
      <>
        <OperationsFilesPage />
        <LocationProbe />
      </>,
      { routes: listRoutes, path, pattern: "/operations/*" },
    );

  it("sends a desktop click to the file's own page", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(
      (await screen.findAllByRole("button", { name: /SBX-2026-0001/ }))[0],
    );

    // The address IS the deliverable here: a modal opened in local state would
    // leave this unchanged, and "look at SBX-2026-0001" would still not be a
    // link anyone could send.
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/files/${ID}`,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exchanges a desktop ?focus= for the route, so every old deep link lands", async () => {
    // The client 360's drill-in, a notification, the back arrow — they all
    // still write `?focus=`, and on a desktop that has to mean the page.
    renderList(`/operations/files?focus=${ID}`);

    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/files/${ID}`,
      ),
    );
  });

  describe("on a phone", () => {
    beforeEach(() => {
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
        (await screen.findAllByRole("button", { name: /SBX-2026-0001/ }))[0],
      );

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Operations file · SBX-2026-0001");
      // Still a step the back arrow can reach — the sheet is in the URL, it is
      // just not a route.
      expect(screen.getByTestId("loc")).toHaveTextContent(
        `/operations/files?focus=${ID}`,
      );
    });
  });
});
