/**
 * Financial dictionary 360 → the usage tiles open the rows they count.
 *
 * WHY THIS FILE EXISTS. The five tiles under a line's header (Costings, Cash
 * requests, Invoices, Purchase orders, Rates) were figures that opened nothing:
 * "57 costings" with no way to see which fifty-seven, for which client, on
 * which file. What this pins, in the order the reader meets it:
 *
 *   1. Every tile is a BUTTON ("Open Costings"), a zero included — "none yet"
 *      is an answer, and the dialog is still the way to the module.
 *   2. Nothing is fetched until a tile is opened.
 *   3. The dialog lists the document, the file ref and the client, and pages
 *      through the SERVER's total ("of 57", the tile's number) rather than
 *      whatever prefix was fetched.
 *   4. A row opens its record; "View more in Costing" opens the module.
 *   5. A refusal (the viewer lacks that module's grant) is said in words, and
 *      offers no link into the module that just refused them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

// Imported AFTER the mock, so this is the faked namespace.
import * as apiClient from "@/lib/api-client";

import { FinancialDictionaryPage } from "./financial-dictionary";

const ITEM = {
  dictionary_item_id: "di1",
  code: "#A003",
  label_fr: "Caution Ambassade — Dépôt",
  label_en: "Embassy Caution — Deposit",
  direction: "ASSET",
  category: "asset",
  subcategory: "BANK_FINANCE",
  applicability_mode: "SERVICE_SCOPED",
  is_active: true,
  currency: "XAF",
  posting_rules: [],
  service_tiers: [],
};

const DOSSIER = {
  item: ITEM,
  posting_rules: [],
  service_tiers: [],
  usage: {
    costing_lines: 57,
    cash_request_lines: 0,
    purchase_order_items: 0,
    invoice_lines: 0,
    supplier_invoice_lines: 0,
    cost_entries: 0,
    expense_rates: 0,
  },
  compliance: {
    requires_justification: false,
    receipt_requirement: "NOT_REQUIRED",
    proof_source: null,
    is_disbursement: false,
    disbursement_vat_transparent: false,
    needs_attention: false,
  },
  capabilities: { edit_rates: false },
};

/** Costing line n of 57 — newest first, as the server orders them. */
const costingLine = (n: number) => ({
  row_id: `cl${n}`,
  doc_id: `co${n}`,
  doc_number: `CST-2026-${String(n).padStart(4, "0")}`,
  status: n === 1 ? "APPROVED_LOCKED" : "DRAFT",
  doc_type: null,
  doc_date: "2026-09-20T10:00:00Z",
  currency: "XAF",
  amount: "250000.00",
  label: n === 1 ? "Embassy caution — 40ft" : "Embassy caution",
  dossier_id: `d${n}`,
  dossier_ref: `SLAS-2026-${String(100 + n)}`,
  party_id: `c${n}`,
  party_name: n === 1 ? "Acme Cameroun SARL" : `Client ${n}`,
});
const TOTAL = 57;

/** Every paged path the screen asks for, answered one page at a time with the
 *  true total — the `X-Total-Count` the endpoint sends. */
let pagedPaths: string[] = [];
let refuse = false;
beforeEach(() => {
  pagedPaths = [];
  refuse = false;
  vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    pagedPaths.push(path);
    if (refuse) {
      throw new apiClient.ApiError(
        "PERMISSION_DENIED",
        "Listing these needs the Costing permission. The count on the tile is all this screen can show you.",
        403,
      );
    }
    const q = new URLSearchParams(path.split("?")[1]);
    const offset = Number(q.get("offset") || 0);
    const limit = Number(q.get("limit") || 20);
    const data = Array.from(
      { length: Math.max(0, Math.min(limit, TOTAL - offset)) },
      (_, i) => costingLine(offset + i + 1),
    );
    return {
      data,
      total: TOTAL,
      limit,
      offset,
      hasMore: offset + limit < TOTAL,
      meta: null,
    };
  }) as typeof apiClient.tenantPaged);
});
afterEach(() => vi.restoreAllMocks());

/** Where the router is, so a navigation can be asserted as a destination. */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function open() {
  renderScreen(
    <>
      <FinancialDictionaryPage />
      <Where />
    </>,
    {
      path: "/master/financial-dictionary",
      routes: {
        "/financial-dictionary": [ITEM],
        "/financial-dictionary/di1/360": DOSSIER,
      },
    },
  );
}

const openCostings = async () => {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /^open costings$/i }),
  );
  await screen.findByRole("heading", { name: /costings · #a003/i });
  return user;
};

describe("Financial dictionary · usage drill-ins", () => {
  it("makes all five tiles open something, zeros included, and fetches nothing until one is opened", async () => {
    open();
    for (const label of [
      /^open costings$/i,
      /^open cash requests$/i,
      /^open invoices$/i,
      /^open purchase orders$/i,
      /^open rates$/i,
    ]) {
      expect(
        await screen.findByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(pagedPaths.some((p) => p.includes("/usage/"))).toBe(false);
  });

  it("lists the costing, its file and its client, one server page at a time", async () => {
    open();
    const user = await openCostings();

    // The first page of the costings list for THIS line.
    expect(pagedPaths).toContain(
      "/financial-dictionary/di1/usage/costings?limit=20&offset=0",
    );
    const row = (await screen.findByText("CST-2026-0001")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("SLAS-2026-101")).toBeInTheDocument();
    expect(within(row).getByText("Acme Cameroun SARL")).toBeInTheDocument();
    // The line's own label rides under the number, so two lines of one sheet
    // (one per container type) are told apart.
    expect(within(row).getByText("Embassy caution — 40ft")).toBeInTheDocument();

    // The pager states the tile's number, not the page's length.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/showing 1–20 of 57/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /^next$/i }));
    expect(await screen.findByText("CST-2026-0021")).toBeInTheDocument();
    expect(pagedPaths).toContain(
      "/financial-dictionary/di1/usage/costings?limit=20&offset=20",
    );
    expect(
      within(dialog).getByText(/showing 21–40 of 57/i),
    ).toBeInTheDocument();
  });

  it("opens a row's costing sheet, and 'View more' opens the Costing module", async () => {
    open();
    let user = await openCostings();
    await user.click(
      await screen.findByRole("button", {
        name: "CST-2026-0001 Embassy caution — 40ft",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/costing/costing/co1",
      ),
    );

    // Fresh screen for the way out, so the first navigation cannot satisfy it.
    cleanup();
    open();
    user = await openCostings();
    await user.click(
      await screen.findByRole("button", { name: /view more in costing/i }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        /^\/costing\/costing$/,
      ),
    );
  });

  it("says why when the viewer may not list these rows, and offers no link into the module", async () => {
    refuse = true;
    open();
    await openCostings();
    expect(
      await screen.findByText(/needs the costing permission/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /view more in costing/i }),
    ).toBeNull();
  });
});
