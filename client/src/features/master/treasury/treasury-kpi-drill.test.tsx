/**
 * Treasury 360 → the movement tiles open the ledger lines behind them.
 *
 * Pinned: Debits, Credits, This month and This year are buttons that read the
 * account's lines with the matching side / period (the server applies the same
 * filter as the tile's sum); Balance and Opening are figures and stay inert;
 * the dialog pages through the server's total and a zero side reads blank.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as apiClient from "@/lib/api-client";
import { TreasuryDossier } from "./dossier";

/** A configured, verified account: no readiness banner, every tab renderable. */
const DOSSIER = {
  account: {
    treasury_account_id: "ta1",
    entity_id: "e1",
    category_id: "cat1",
    kind: "BANK",
    label: "Afriland Main XAF",
    coa_code: "521100",
    currency: "XAF",
    is_active: true,
    is_primary: true,
    is_verified: true,
    verified_by: "u1",
    verified_at: "2026-01-15T09:00:00Z",
    bank_name: "Afriland First Bank",
    branch: "Douala Akwa",
    account_number: "10005000123456789012",
    iban: null,
    swift_bic: "CCEICMCX",
    routing_code: null,
    holder_name: "Smart Logistics",
    opening_balance: 0,
    opening_date: "2026-01-01",
    statement_day: 28,
    custodian_user_id: null,
    location: null,
    category_code: "BANK",
    category_requires_custodian: false,
    float_limit: null,
  },
  category: {
    treasury_category_id: "cat1",
    code: "BANK",
    label: "Bank",
    legacy_kind: "BANK",
    coa_parent_code: "521",
    requires_custodian: false,
    is_bank_identity: true,
    is_momo_identity: false,
    is_system: true,
    is_active: true,
  },
  coa_leaf: {
    code: "521100",
    parent_code: "521",
    label_fr: "Afriland Main XAF",
    label_en: "Afriland Main XAF",
    class: 5,
    is_postable: true,
    is_active: true,
  },
  custodian: null,
  verifier: { user_id: "u1", full_name: "Awa Treasury", email: null },
  kpis: {
    opening_balance: 0,
    posted_net: 0,
    balance: 0,
    currency: "XAF",
    debit_total: 0,
    credit_total: 0,
    mtd: { debit: 0, credit: 0, net: 0 },
    ytd: { debit: 0, credit: 0, net: 0 },
    unreconciled_count: 0,
  },
  last_debit: null,
  last_credit: null,
  monthly_series: [],
  recent_lines: [],
  documents: [],
  signatories: [],
  timeline: [],
  readiness: { items: [], done: 5, total: 5, percent: 100 },
};

const LINES = [
  {
    line_id: "l1",
    entry_id: "e1",
    entry_date: "2026-09-26",
    entry_no: 41,
    description: "Receipt — Acme Cameroun SARL",
    source_doc_ref: "RC-2026-0088",
    journal_code: "BQ1",
    debit: "12500000.00",
    credit: "0.00",
    currency: "XAF",
    dossier_id: "d1",
    dossier_ref: "SLAS-2026-0101",
  },
];

let paths: string[] = [];
beforeEach(() => {
  paths = [];
  vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    paths.push(path);
    return {
      data: LINES,
      total: 212,
      limit: 20,
      offset: 0,
      hasMore: true,
      meta: null,
    };
  }) as typeof apiClient.tenantPaged);
});
afterEach(() => vi.restoreAllMocks());

const mount = () =>
  renderScreen(<TreasuryDossier id="ta1" />, {
    routes: {
      "/treasury-accounts/ta1/360": DOSSIER,
      "/entities": [],
      "/treasury-categories": [],
    },
  });

describe("Treasury 360 · movement drill-ins", () => {
  it("makes the four movement tiles buttons and leaves Balance and Opening inert", async () => {
    mount();
    for (const n of [
      /^open debits \(posted\)$/i,
      /^open credits \(posted\)$/i,
      /^open this month \(net\)$/i,
      /^open this year \(net\)$/i,
    ]) {
      expect(
        await screen.findByRole("button", { name: n }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /^open balance$/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^open opening$/i }),
    ).toBeNull();
    expect(paths).toEqual([]);
  });

  it.each([
    [/^open debits \(posted\)$/i, "side=debit&period=all"],
    [/^open credits \(posted\)$/i, "side=credit&period=all"],
    [/^open this month \(net\)$/i, "period=mtd"],
    [/^open this year \(net\)$/i, "period=ytd"],
  ])("%s reads the lines with %s", async (tile, filter) => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: tile }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Receipt — Acme Cameroun SARL"),
    ).toBeInTheDocument();
    expect(paths).toEqual([
      `/treasury-accounts/ta1/lines?limit=20&offset=0&${filter}`,
    ]);
    // The pager states the server's total, the lines the figure was added from.
    expect(within(dialog).getByText(/of 212/)).toBeInTheDocument();
    expect(within(dialog).getByText("SLAS-2026-0101")).toBeInTheDocument();
  });
});
