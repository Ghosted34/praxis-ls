/**
 * Treasury 360 — the active tab lives in `?tab=`, not in component state.
 *
 * The bug this pins: the dossier held its tab in `React.useState`, so a reload
 * dumped the reader back on Overview — on a 360 whose route comment says it
 * exists precisely to be deep-linkable from invoicing, receipts and alerts.
 * `useUrlTab` is the house pattern (entity-360 & co): the URL is the state,
 * "Overview" is the fallback so the param is omitted there, and a remount at
 * the same URL — which is what a browser reload IS — lands on the same tab.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

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

const ROUTES = {
  "/treasury-accounts/ta1/360": DOSSIER,
  "/entities": [],
  "/treasury-categories": [],
};

/** The URL as the router sees it, captured on every navigation. */
let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

const mount = (path = "/") =>
  renderScreen(
    <>
      <TreasuryDossier id="ta1" />
      <LocationProbe />
    </>,
    { routes: ROUTES, path },
  );

describe("TreasuryDossier · tab state is URL state", () => {
  it("switching tab writes ?tab=, and a remount at that URL restores the tab", async () => {
    const user = userEvent.setup();
    const first = mount();

    // Starts on Overview with no param — the fallback keeps the URL clean.
    expect(await screen.findByText("Bank identity")).toBeInTheDocument();
    expect(lastSearch).toBe("");

    await user.click(screen.getByRole("button", { name: "Signatories" }));
    expect(
      await screen.findByText("Authorized signatories"),
    ).toBeInTheDocument();
    expect(lastSearch).toBe("?tab=Signatories");

    // The remount is the reload: a fresh tree at the URL the click produced
    // must land on Signatories, not Overview.
    first.unmount();
    mount("/?tab=Signatories");
    expect(
      await screen.findByText("Authorized signatories"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bank identity")).toBeNull();
  });

  it("a multi-word tab round-trips through the param (CoA leaf)", async () => {
    mount("/?tab=CoA+leaf");
    expect(
      await screen.findByText(/auto-minted CoA leaf/),
    ).toBeInTheDocument();
  });

  it("an unknown ?tab= value falls back to Overview instead of rendering nothing", async () => {
    mount("/?tab=Statements");
    expect(await screen.findByText("Bank identity")).toBeInTheDocument();
  });
});
