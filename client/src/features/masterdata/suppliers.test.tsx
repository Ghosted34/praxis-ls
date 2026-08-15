/**
 * Regression test — Configure → Master data → Suppliers must not crash on load.
 *
 * INCIDENT. `PartyDossier` (party-360.tsx) unconditionally read `d.dossiers.length`
 * when building the tab-count map. Dossiers are a client-only field on the 360
 * response — the server's `/suppliers/:id/360` handler doesn't return one — so the
 * expression threw "Cannot read properties of undefined (reading 'length')" on
 * every visit to the suppliers page (the list auto-selects the first row on
 * arrival, mounting the dossier). The screen-level ErrorBoundary caught it and
 * showed "This screen couldn't be displayed" in place of the whole page.
 *
 * The intersection cast (`Client360 & Supplier360`) hid this from the type
 * checker, and the axe-test register wires a lighter `master/suppliers` page
 * that doesn't mount `PartyDossier` — so nothing exercised the supplier branch
 * of the dossier until the browser did.
 *
 * WHAT THIS ASSERTS. Rendering the masterdata SuppliersPage with a supplier
 * fixture whose `/suppliers/:id/360` response omits `dossiers` (matching the
 * real server) settles onto the supplier tabs bar — not onto the boundary's
 * "This screen couldn't be displayed" fallback. If someone reintroduces an
 * unconditional read of a client-only field on the supplier branch, this test
 * catches it before the users do.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { SuppliersPage } from "./suppliers";

const SUPPLIER = {
  supplier_id: "s1",
  name: "Total Energies",
  is_active: true,
} as const;

/** Shape of the supplier 360 the server actually returns — note: no `dossiers`. */
const SUPPLIER_360 = {
  party: {
    supplier_id: "s1",
    name: "Total Energies",
    legal_name: "Total Energies SA",
    is_active: true,
    country_code: "CM",
    compliance_state: "OK",
    registration_status: "ACTIVE",
    verification_status: "VERIFIED",
  },
  kpis: {
    payables: 0,
    overdue_payables: 0,
    oldest_due_date: null,
    ytd_spend: 0,
    open_purchase_orders: 0,
    aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  },
  compliance: { compliance_state: "OK", can_verify: false, flags: [] },
  gl_parity: { ok: true, ledger: 0, subledger: 0, delta: 0 },
  contacts: [],
  addresses: [],
  banks: [],
  documents: [],
  registrations: [],
  beneficial_owners: [],
  purchase_orders: [],
  supplier_invoices: [],
  scorecard: {
    score_on_time: 0,
    score_claims: 0,
    score_disputes: 0,
    score_responsiveness: 0,
    score_safety: 0,
    score_compliance: 0,
    score_overall: 0,
  },
  aliases: [],
  duplicate_candidates: [],
  pending_changes: [],
  // NB: no `dossiers` — this mirrors src/modules/master/party-360.service.js
  // (`supplierDossier` returns purchase_orders/supplier_invoices, never dossiers).
};

describe("Master data · Suppliers", () => {
  it("renders the dossier without crashing when the 360 response omits client-only fields", async () => {
    renderScreen(<SuppliersPage />, {
      routes: {
        "/suppliers": [SUPPLIER],
        "/suppliers/s1/360": SUPPLIER_360,
        "/party-document-types": [],
      },
    });

    // The list rendered the supplier row (top-of-page assertion) …
    expect(
      await screen.findByRole("button", { name: /Total Energies/i }),
    ).toBeInTheDocument();

    // … and the dossier settled onto its tab bar (proves `d.dossiers.length`
    // did not throw — a throw would land the ErrorBoundary fallback below).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Documents/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^Banks/i })).toBeInTheDocument();
    // Suppliers have no Operations tab (dossiers are a client concept).
    expect(
      screen.queryByRole("button", { name: /^Operations/i }),
    ).not.toBeInTheDocument();

    // Guard: the screen-level ErrorBoundary must not have fired.
    expect(
      screen.queryByText(/This screen couldn't be displayed/i),
    ).not.toBeInTheDocument();
  });
});
