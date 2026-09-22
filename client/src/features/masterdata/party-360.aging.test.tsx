/**
 * Party 360 · the Aging card on a phone.
 *
 * WHAT WENT WRONG. The card laid its five buckets out as `grid grid-cols-5` at
 * EVERY width. On a 390px phone each box is ~62px wide, and a full-precision
 * figure wraps MID-NUMBER inside it — "759,812.50" painted as "759,812.50.00",
 * "6,847,500.00" as "6,847,5000.00" — which reads as a wrong amount. The KPI
 * strip solved the same defect by going two-up below `md` (kpi-tile.tsx); the
 * Aging card now does the same: Current spans the top row, the rest sit two
 * per row, and the values use the compact formatter. The exact figure stays
 * one long-press away in the tile's `title`, on the bar under the tiles, and
 * in the drill-down each tile opens.
 *
 * jsdom has no layout engine, so this pins the STRUCTURE that produces the
 * fix — two columns below `md` with Current spanning, five across from `md`
 * up — the same way kpi-tile.test.tsx pins its row's shape.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { PartyDossier } from "./party-360";

/** The two figures from the field report: 759,812.50 current, 6,847,500 in
 *  31–60. Both wrapped mid-number in the five-across phone grid. */
const CLIENT_360 = {
  party: {
    client_id: "c1",
    name: "Bolloré Transport & Logistics",
    legal_name: "Bolloré Transport & Logistics SA",
    ref: "CLI-001",
    is_active: true,
    country_code: "CM",
    compliance_state: "OK",
    registration_status: "ACTIVE",
    verification_status: "VERIFIED",
    hard_blocked_at: null,
  },
  kpis: {
    outstanding: 759_812.5,
    overdue: 6_847_500,
    oldest_due_date: null,
    credit_limit: 5_000_000,
    credit_available: 5_000_000,
    ytd_revenue: 0,
    dossiers_in_progress: 0,
    aging: {
      current: 759_812.5,
      d1_30: 0,
      d31_60: 6_847_500,
      d61_90: 0,
      d90_plus: 0,
    },
  },
  compliance: { compliance_state: "OK", can_verify: false, flags: [] },
  gl_parity: { ok: true, ledger: 0, subledger: 0, delta: 0 },
  contacts: [],
  addresses: [],
  banks: [],
  documents: [],
  registrations: [],
  beneficial_owners: [],
  dossiers: [],
  invoices: [],
  receipts: [],
  advances: [],
  aliases: [],
  duplicate_candidates: [],
  pending_changes: [],
};

const ROUTES = {
  "/clients/c1/360": CLIENT_360,
  "/party-document-types": [],
};

/** `(min-width: …)` queries never match — the phone tier. */
function stubCompact() {
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
}

/** Every `(min-width: …)` query matches — the desktop tier. */
function stubDesktop() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.unstubAllGlobals());

const mount = () =>
  renderScreen(<PartyDossier kind="client" partyId="c1" onEdit={() => {}} />, {
    routes: ROUTES,
    path: "/",
  });

/** Bucket labels also appear as SVG text in the bar chart under the tiles, so
 *  pick the occurrence that sits inside a tile button. The dossier fetches,
 *  so wait for the tiles to land. */
const tileFor = async (label: string) => {
  const node = (await screen.findAllByText(label)).find((n) =>
    n.closest("button"),
  );
  expect(node, `a "${label}" tile`).toBeTruthy();
  return node!.closest("button") as HTMLElement;
};

describe("AgingCard · the phone layout", () => {
  it("is two-up below md with Current spanning, never five-across", async () => {
    stubCompact();
    mount();
    const current = await tileFor("Current");

    const grid = current.parentElement as HTMLElement;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).not.toContain("grid-cols-5");
    expect(current.className).toContain("col-span-2");

    // Four buckets after the spanning Current tile: an even two rows.
    expect(grid.children).toHaveLength(5);
  });

  it("shows the compact figure, with the exact one a long-press away", async () => {
    stubCompact();
    mount();
    const grid = (await tileFor("Current")).parentElement as HTMLElement;

    // The two figures that wrapped mid-number now fit on one line.
    expect(within(grid).getByText("759.8K XAF")).toBeInTheDocument();
    expect(within(grid).getByText("6.8M XAF")).toBeInTheDocument();
    // Precision is not lost — the title carries the full figure.
    expect(await tileFor("Current")).toHaveAttribute(
      "title",
      "759,812.50 XAF",
    );
    expect(await tileFor("31–60")).toHaveAttribute("title", "6,847,500.00 XAF");
  });

  it("keeps five-across full-precision tiles from md up", async () => {
    stubDesktop();
    mount();
    const current = await tileFor("Current");

    const grid = current.parentElement as HTMLElement;
    expect(grid.className).toContain("grid-cols-5");
    expect(current.className).not.toContain("col-span-2");
    expect(within(grid).getByText("759,812.50 XAF")).toBeInTheDocument();
  });
});
