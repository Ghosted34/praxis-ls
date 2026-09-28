/**
 * Financial dictionary → Spend tab: every tile opens the documents behind it.
 *
 * Pinned: the four tiles are buttons; each reads GET /:id/spend/documents with
 * the tab's own (server-normalised) window and its lens — Documents reads every
 * lens; the pager states the server's total. And the Documents tile counts the
 * three lenses rather than the length of the list under the chart, which stops
 * at 100.
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
import { SpendTab } from "./financial-dictionary-spend";

const SPEND = {
  item: {
    dictionary_item_id: "di1",
    code: "#R001",
    label_fr: "Frais de transit",
    label_en: "Transit fee",
    currency: "XAF",
    direction: "REVENUE",
  },
  period: { from: "2025-09-01", to: "2026-08-09", swapped: false },
  months: [
    {
      month: "2026-06",
      estimated: 120000,
      estimated_count: 1,
      committed: 100000,
      committed_count: 1,
      actual: 90000,
      actual_count: 2,
    },
    // A genuinely empty month — the dense-axis case. It must render as a zero
    // row, not be dropped.
    {
      month: "2026-07",
      estimated: 0,
      estimated_count: 0,
      committed: 0,
      committed_count: 0,
      actual: 0,
      actual_count: 0,
    },
    {
      month: "2026-08",
      estimated: 60000,
      estimated_count: 1,
      committed: 55000,
      committed_count: 1,
      actual: 50000,
      actual_count: 1,
    },
  ],
  totals: {
    estimated: 180000,
    committed: 155000,
    actual: 140000,
    estimated_count: 2,
    committed_count: 2,
    actual_count: 3,
    headline: 140000,
    variance_committed_actual: 15000,
    variance_estimated_actual: 40000,
  },
  documents: [
    {
      lens: "actual",
      doc_type: "cost_entry",
      doc_id: "ce1",
      doc_number: null,
      status: "validated",
      dossier_id: "d1",
      dossier_ref: "SBX-2026-0007",
      amount: 50000,
      currency: "XAF",
      doc_date: "2026-08-02",
      label: "Transit",
    },
    {
      lens: "committed",
      doc_type: "purchase_order",
      doc_id: "po1",
      doc_number: "PO-2026-001",
      status: "ISSUED_LOCKED",
      dossier_id: "d1",
      dossier_ref: "SBX-2026-0007",
      amount: 55000,
      currency: null,
      doc_date: "2026-08-01",
      label: "Transit fee",
    },
  ],
};

let paths: string[] = [];
beforeEach(() => {
  paths = [];
  vi.spyOn(apiClient, "tenantPaged").mockImplementation((async (
    path: string,
  ) => {
    paths.push(path);
    return {
      data: SPEND.documents,
      total: 340,
      limit: 20,
      offset: 0,
      hasMore: true,
      meta: null,
    };
  }) as typeof apiClient.tenantPaged);
});
afterEach(() => vi.restoreAllMocks());

const mount = () =>
  renderScreen(<SpendTab id="di1" />, {
    routes: { "/financial-dictionary/di1/spend": SPEND },
  });

describe("Spend tab · drill-ins", () => {
  it("counts every lens on the Documents tile, not the capped list", async () => {
    mount();
    const tile = await screen.findByRole("button", {
      name: /^open documents$/i,
    });
    // 3 actual + 2 committed + 2 estimated in the fixture's totals.
    expect(within(tile).getByText("7")).toBeInTheDocument();
  });

  it.each([
    [/^open actual/i, "&lens=actual"],
    [/^open committed$/i, "&lens=committed"],
    [/^open estimated$/i, "&lens=estimated"],
    [/^open documents$/i, ""],
  ])("%s reads its lens over the tab's window", async (tile, lens) => {
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: tile }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("PO-2026-001")).toBeInTheDocument();
    expect(paths).toEqual([
      `/financial-dictionary/di1/spend/documents?limit=20&offset=0&from=2025-09-01&to=2026-08-09${lens}`,
    ]);
    expect(within(dialog).getByText(/of 340/)).toBeInTheDocument();
  });
});
