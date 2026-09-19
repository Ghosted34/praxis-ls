/**
 * Party 360 — the active tab lives in `?tab=`, not in component state.
 *
 * The bug this pins: the dossier held its tab in `React.useState`, so a reload
 * (or any remount) dumped the reader back on Overview and a link could reach
 * the page but never the tab. `useUrlTab` is the house pattern (entity-360,
 * employee-360, the operations 360s): the URL is the state, "Overview" is the
 * fallback so the param is omitted there, and a remount at the same URL — which
 * is what a browser reload IS — lands on the same tab.
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

import { PartyDossier } from "./party-360";

/** Minimal client 360 — enough for the shell, the tab bar and each panel. */
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
    outstanding: 0,
    overdue: 0,
    oldest_due_date: null,
    credit_limit: 5_000_000,
    credit_available: 5_000_000,
    ytd_revenue: 0,
    dossiers_in_progress: 0,
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

/** The URL as the router sees it, captured on every navigation. */
let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

const mount = (path = "/") =>
  renderScreen(
    <>
      <PartyDossier kind="client" partyId="c1" onEdit={() => {}} />
      <LocationProbe />
    </>,
    { routes: ROUTES, path },
  );

describe("PartyDossier · tab state is URL state", () => {
  it("switching tab writes ?tab=, and a remount at that URL restores the tab", async () => {
    const user = userEvent.setup();
    const first = mount();

    // Starts on Overview with no param — the fallback keeps the URL clean.
    expect(await screen.findByText("Compliance")).toBeInTheDocument();
    expect(lastSearch).toBe("");

    await user.click(screen.getByRole("button", { name: /^Banks/ }));
    expect(await screen.findByText("Bank accounts")).toBeInTheDocument();
    expect(lastSearch).toBe("?tab=Banks");

    // The remount is the reload: a fresh tree at the URL the click produced
    // must land on Banks, not Overview.
    first.unmount();
    mount("/?tab=Banks");
    expect(await screen.findByText("Bank accounts")).toBeInTheDocument();
    expect(screen.queryByText("Compliance")).toBeNull();
  });

  it("returning to Overview drops the param rather than pinning ?tab=Overview", async () => {
    const user = userEvent.setup();
    mount("/?tab=Registrations");

    expect(await screen.findByText("Registrations / tax IDs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Overview$/ }));
    expect(await screen.findByText("Compliance")).toBeInTheDocument();
    expect(lastSearch).toBe("");
  });

  it("an unknown ?tab= value falls back to Overview instead of rendering nothing", async () => {
    mount("/?tab=Renamed%20Since");
    expect(await screen.findByText("Compliance")).toBeInTheDocument();
  });
});
