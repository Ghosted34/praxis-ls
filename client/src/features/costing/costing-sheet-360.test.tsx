/**
 * The costing worksheet — what it must not lose.
 *
 * WHAT THESE PIN, and why each is a defect waiting to happen.
 *
 * 1. THE SHEET NAMES ITSELF FROM THE RESPONSE ALONE. It is a route, so a sheet
 *    reached from a pasted link has a uuid and nothing else. If `GET
 *    /costings/:id` ever stops carrying `file`, the regression is silent — a
 *    header reading "CST-2026-0043 · undefined" still renders.
 *
 * 2. NATURE AND VAT COME FROM THE CATALOGUE. The legacy sheet asked the user to
 *    tick a VAT box that defaulted to ticked, which is why its sample sheet
 *    charges 19.25% VAT on a customs duty. A pass-through line must offer no VAT
 *    control at all, and must say why.
 *
 * 3. DÉBOURS VAT IS BUDGETED, AND MARKED (PT) (12768). The débours net is in HT
 *    and the supplier's VAT is in the VAT total and TTC — a costing is a cash
 *    budget. The (PT) tag and a rate control are what a reader sees on the line.
 *
 * 4. SUGGEST TOPS UP. A charge already on the sheet is offered as already
 *    present, never re-added — because re-adding it would silently duplicate a
 *    line somebody had already priced by hand.
 *
 * 5. THE REGISTER'S MONEY AND COUNTS ARE THE SERVER'S. Its Total column read two
 *    fields that were never columns, and its KPI strip counted the loaded page.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CostingSheet360Page } from "./costing-sheet-360";
import { CostingPage } from "./pages";

const ID = "c-1";

const OCEAN = {
  costing_line_id: "l-1",
  dictionary_item_id: "di-ocean",
  label: "Ocean Freight",
  item_code: "#E014",
  qty: 2,
  unit_cost: 500_000,
  is_disbursement: false,
  tax_code_id: "tc-std",
  tax_rate_percent: 19.25,
  line_no: 1,
};

/** The Maersk demurrage: net re-billed, supplier VAT budgeted on top (12768) —
 *  priced from a rate, so it loads in rate mode. */
const DEMURRAGE = {
  costing_line_id: "l-2",
  dictionary_item_id: "di-dem",
  label: "Demurrage",
  item_code: "#D077",
  qty: 1,
  unit_cost: 100_000,
  is_disbursement: true,
  upstream_vat_amount: 19_250,
  upstream_vat_rate_percent: 19.25,
  disbursement_vat_transparent: true,
  container_type_code: "45'HC",
  container_type_ref_id: "ct-45",
  line_no: 2,
};

const SHEET = {
  costing_id: ID,
  doc_number: "CST-2026-0043",
  dossier_id: "d-1",
  status: "DRAFT",
  currency: "XAF",
  exchange_rate_to_xaf: 1,
  remarks: "Carrier rate confirmed 25/07.",
  validator_id: "u-2",
  created_at: "2026-09-01T09:00:00Z",
  lines: [OCEAN, DEMURRAGE],
  totals: {
    service_cost: 1_000_000,
    disbursement_total: 119_250,
    total_ht: 1_119_250,
    vat_total: 192_500,
    total_ttc: 1_311_750,
    total_cost: 1_119_250,
    upstream_vat_total: 19_250,
    total_ttc_xaf: 1_311_750,
  },
  // The display fields the header renders from — a pasted link has nothing else.
  file: {
    dossier_id: "d-1",
    ref: "SLAS-2026-0001",
    client_name: "FMA Services Construction International",
    service_type_id: "st-1",
    service_type_key: "SEA_FREIGHT_IMPORT",
    service_name_en: "Sea Freight Import",
    rate_provider_id: "rp-msc",
    rate_provider_name: "MSC",
  },
  containers: [{ container_type_ref_id: "ct-45", qty: 1, container_type_code: "45'HC" }],
  shipment_details: null,
  shipment_details_source: null,
  amendment: null,
};

const VAT_CODES = {
  codes: [{ tax_code_id: "tc-std", code: "TVA_STD", rate_percent: 19.25 }],
};

const renderSheet = (sheet: Record<string, unknown> = SHEET) =>
  renderScreen(<CostingSheet360Page />, {
    path: `/costing/costing/${ID}`,
    pattern: "/costing/costing/:costingId",
    routes: {
      [`/costings/${ID}`]: sheet,
      "/tax-codes/sales": VAT_CODES,
      "/users": [
        { user_id: "u-2", full_name: "Jean Mballa" },
        { user_id: "u-3", full_name: "Awa Njoya" },
      ],
    },
  });

describe("the costing worksheet", () => {
  it("names the file from the response alone — a pasted link has only a uuid", async () => {
    renderSheet();
    expect(await screen.findByText("CST-2026-0043")).toBeInTheDocument();
    // Reference, client, service and carrier all come from `file`.
    expect(
      screen.getByText(/SLAS-2026-0001/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/FMA Services Construction International/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Sea Freight Import/)).toBeInTheDocument();
    expect(screen.getByText(/MSC/)).toBeInTheDocument();
  });

  it("humanises the status — never the raw enum on screen", async () => {
    renderSheet({ ...SHEET, status: "SUBMITTED_FOR_VALIDATION" });
    expect(await screen.findByText("To validate")).toBeInTheDocument();
    expect(screen.queryByText("SUBMITTED_FOR_VALIDATION")).not.toBeInTheDocument();
  });

  it("gives a pass-through line a VAT rate control (12768), not a dead label", async () => {
    renderSheet();
    await screen.findByText("CST-2026-0043");
    // The service line gets a VAT-code picker…
    expect(
      screen.getByLabelText(/VAT code — Ocean Freight/i),
    ).toBeInTheDocument();
    // …and the débours gets its own rate picker (default box), where the old
    // "not taxed" label used to sit.
    expect(
      screen.getByLabelText(/VAT rate — Demurrage/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pass-through — not taxed/i)).not.toBeInTheDocument();
    // …marked (PT) so it still reads as a pass-through.
    expect(screen.getAllByText(/Pass-through \(PT\)/i).length).toBeGreaterThan(0);
  });

  it("budgets the supplier's VAT into the total, marked (PT)", async () => {
    renderSheet();
    await screen.findByText("CST-2026-0043");
    // 1,000,000 service + 100,000 débours net = 1,100,000 HT.
    expect(screen.getAllByText(/1,100,000/).length).toBeGreaterThan(0);
    // VAT = 192,500 service + 19,250 débours = 211,750, in the total now.
    expect(screen.getAllByText(/211,750/).length).toBeGreaterThan(0);
    // …and named as the supplier's own on débours (PT) — the VAT tile's hint
    // and the memo line beneath the totals both say so.
    expect(
      screen.getAllByText(/on débours \(PT\)/i).length,
    ).toBeGreaterThan(0);
  });

  it("groups VAT by rate, and the débours (PT) row shows its budgeted VAT", async () => {
    renderSheet();
    await screen.findByText("CST-2026-0043");
    expect(screen.getByText("19.25%")).toBeInTheDocument();
    // The pass-through row now carries a real VAT figure, not a dash.
    expect(
      screen.getByText(/Re-billed at cost; the VAT is the supplier's, budgeted into the total/i),
    ).toBeInTheDocument();
  });

  it("locks the sheet once it is approved, and drops the edit controls", async () => {
    renderSheet({ ...SHEET, status: "APPROVED_LOCKED" });
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Suggest charges/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/i })).not.toBeInTheDocument();
    // …and offers the way out instead.
    expect(
      screen.getByRole("button", { name: /Request unlock/i }),
    ).toBeInTheDocument();
  });

  it("asks for the unlock reason in a real dialog, never a browser prompt", async () => {
    const user = userEvent.setup();
    renderSheet({ ...SHEET, status: "APPROVED_LOCKED" });
    await screen.findByText("Approved");
    await user.click(screen.getByRole("button", { name: /Request unlock/i }));
    // A labelled field, which `window.prompt` can never be: it is drawn by the
    // browser, cannot be translated, and blocks the event loop.
    expect(
      await screen.findByLabelText(/Why does it need reopening/i),
    ).toBeInTheDocument();
  });

  it("shows what moved since the last approval, and counts the rest", async () => {
    renderSheet({
      ...SHEET,
      status: "SUBMITTED_FOR_APPROVAL",
      amendment: {
        added: [
          {
            key: "di-storage|-",
            label: "Storage",
            qty: 3,
            unit_cost: 40_000,
            is_disbursement: false,
            amount: 120_000,
            delta: 120_000,
          },
        ],
        changed: [
          {
            key: "di-dem|ct-45",
            label: "Demurrage",
            qty: 1,
            unit_cost: 780_000,
            is_disbursement: true,
            amount: 780_000,
            was_amount: 450_000,
            delta: 330_000,
          },
        ],
        removed: [],
        unchanged_count: 12,
        before_ht: 1_000_000,
        after_ht: 1_450_000,
        delta_ht: 450_000,
        delta_percent: 45,
        has_changes: true,
        since_revision: 1,
        approved_at: "2026-09-02T10:00:00Z",
      },
    });
    await screen.findByText("CST-2026-0043");
    expect(
      screen.getByText(/Changed since it was approved/i),
    ).toBeInTheDocument();
    // The two lines that moved, each labelled by what happened to it.
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    // The roll-up, which is the figure an approver actually decides on: what the
    // sheet was, what it became, and the movement between them. `450,000` alone
    // is ambiguous — the changed line also carries it as its old amount.
    expect(
      screen.getByText("1,000,000.00 XAF → 1,450,000.00 XAF"),
    ).toBeInTheDocument();
    expect(screen.getByText("+450,000.00 XAF (+45%)")).toBeInTheDocument();
    // The whole point is that it is SHORT: unchanged lines are counted.
    expect(screen.getByText(/12 line\(s\) unchanged/i)).toBeInTheDocument();
  });
});

describe("Suggest", () => {
  const SUGGESTION = {
    file: {
      dossier_id: "d-1",
      ref: "SLAS-2026-0001",
      client_name: "FMA Services",
      service_type_id: "st-1",
      service_type_key: "SEA_FREIGHT_IMPORT",
      service_name_en: "Sea Freight Import",
      rate_provider_id: "rp-msc",
      rate_provider_name: "MSC",
      containers: [
        { container_type_ref_id: "ct-45", code: "45'HC", label: "45' High Cube", qty: 1 },
      ],
    },
    tier: "ADVANCED",
    bands: [
      {
        tier: "BASIC",
        lines: [
          {
            // Already on the sheet — must be offered as present, not re-added.
            dictionary_item_id: "di-ocean",
            item_code: "#E014",
            label: "Ocean Freight",
            is_disbursement: false,
            is_billable: true,
            disbursement_vat_transparent: false,
            tax_code_id: "tc-std",
            tax_code: "TVA_STD",
            tax_rate_percent: 19.25,
            tier: "BASIC",
            sort_order: 101,
            container_type_ref_id: null,
            container_type_code: null,
            container_type_label: null,
            qty: 1,
            qty_basis: "DEFAULT",
            unit_cost: 500_000,
            currency: "XAF",
            price_source: "EXPENSE_RATE",
            price_note: null,
            expense_rate_id: "r-1",
            effective_from: "2026-07-01",
            rate_scope: "CARRIER",
          },
          {
            dictionary_item_id: "di-thc",
            item_code: "#E021",
            label: "Terminal Handling",
            is_disbursement: false,
            is_billable: true,
            disbursement_vat_transparent: false,
            tax_code_id: "tc-std",
            tax_code: "TVA_STD",
            tax_rate_percent: 19.25,
            tier: "BASIC",
            sort_order: 102,
            container_type_ref_id: "ct-45",
            container_type_code: "45'HC",
            container_type_label: "45' High Cube",
            qty: 1,
            qty_basis: "CONTAINERS",
            unit_cost: null,
            currency: null,
            price_source: "NONE",
            price_note: null,
            expense_rate_id: null,
            effective_from: null,
            rate_scope: null,
          },
        ],
      },
    ],
    counts: {
      total: 2,
      priced: 1,
      needs_price: 1,
      needs_quantity: 0,
      disbursements: 0,
    },
    defaults: {
      tax_code_id: "tc-std",
      tax_code: "TVA_STD",
      tax_rate_percent: 19.25,
      vat_regime: "REEL",
      priced_on: "2026-09-03",
    },
  };

  const open = async () => {
    const user = userEvent.setup();
    renderScreen(<CostingSheet360Page />, {
      path: `/costing/costing/${ID}`,
      pattern: "/costing/costing/:costingId",
      routes: {
        [`/costings/${ID}`]: SHEET,
        "/costings/suggest": SUGGESTION,
        "/tax-codes/sales": VAT_CODES,
        "/users": [],
      },
    });
    await screen.findByText("CST-2026-0043");
    await user.click(screen.getByRole("button", { name: /Suggest charges/i }));
    return user;
  };

  it("tops up — a charge already on the sheet is not offered again", async () => {
    await open();
    // Ocean Freight is line 1 of the sheet, so Suggest reports it rather than
    // offering a second copy for somebody to import by accident.
    expect(await screen.findByText(/Already on the sheet/i)).toBeInTheDocument();
    // …and the button counts only what would actually be added.
    expect(
      await screen.findByRole("button", { name: /Import 1 line/i }),
    ).toBeInTheDocument();
  });

  it("badges a line with no rate on file rather than pricing it at zero", async () => {
    await open();
    // Zero is a price; blank is an admission, and it is what makes the
    // "needs a price" count truthful.
    expect(await screen.findByText(/Needs a price/i)).toBeInTheDocument();
    expect(
      screen.getByText(/1 line\(s\) have no rate on file/i),
    ).toBeInTheDocument();
  });

  it("shows the equipment a per-container charge was priced for", async () => {
    await open();
    expect(await screen.findAllByText(/45' High Cube/)).not.toHaveLength(0);
  });
});

describe("the costing register", () => {
  const ROWS = [
    {
      costing_id: ID,
      doc_number: "CST-2026-0043",
      dossier_ref: "SLAS-2026-0001",
      client_name: "FMA Services",
      service_name_en: "Sea Freight Import",
      status: "APPROVED_LOCKED",
      currency: "XAF",
      total_ttc: 1_311_750,
      created_at: "2026-09-01T09:00:00Z",
    },
  ];
  const KPIS = {
    total: 9,
    draft: 2,
    to_validate: 3,
    to_approve: 1,
    approved: 3,
    unlock_requested: 0,
    total_ttc_xaf: 42_000_000,
  };

  it("shows the row's real money — the column used to read fields that were never columns", async () => {
    renderScreen(<CostingPage />, {
      routes: { "/costings/kpis": KPIS, "/costings": ROWS, "/operations": [] },
    });
    expect((await screen.findAllByText("CST-2026-0043")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,311,750/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("FMA Services").length).toBeGreaterThan(0);
  });

  it("takes its counts from the server, not from the loaded page", async () => {
    renderScreen(<CostingPage />, {
      // One row on the page; nine matching the filter. Counting rows would
      // print "1", which is what the strip used to do.
      routes: { "/costings/kpis": KPIS, "/costings": ROWS, "/operations": [] },
    });
    await screen.findAllByText("CST-2026-0043");
    // 9 matching the filter, 3 to validate — from /costings/kpis. Counting the
    // one loaded row would print "1", which is what the strip used to do.
    await waitFor(() =>
      expect(screen.getByTitle("9")).toBeInTheDocument(),
    );
    expect(screen.getByTitle("3")).toBeInTheDocument();
  });
});
