/**
 * A client's 360 (client portal PR 3): who looks after the client on the
 * Overview, and a Messages tab — the client's portal conversations and the
 * reply box — for the people who answer clients (MOD-64C). Someone without
 * that permission does not get a tab whose every read would be refused, and a
 * supplier has no portal conversation to show.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

const access = vi.hoisted(() => ({ inbox: true }));

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());
vi.mock("@/lib/route-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/route-access")>("@/lib/route-access");
  return { ...actual, useCanUseModule: (key: string) => (key.toUpperCase() === "MOD-64C" ? access.inbox : true) };
});

import { PartyDossier } from "./party-360";

const PARTY = {
  name: "Acme Trading",
  legal_name: "Acme Trading SARL",
  ref: "CLI-001",
  is_active: true,
  country_code: "CM",
  compliance_state: "OK",
  registration_status: "ACTIVE",
  verification_status: "VERIFIED",
  hard_blocked_at: null,
};
const REST = {
  kpis: {
    outstanding: 0, overdue: 0, oldest_due_date: null, credit_limit: 0, credit_available: 0, ytd_revenue: 0,
    dossiers_in_progress: 0, aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  },
  compliance: { compliance_state: "OK", can_verify: false, flags: [] },
  gl_parity: { ok: true, ledger: 0, subledger: 0, delta: 0 },
  contacts: [], addresses: [], banks: [], documents: [], registrations: [], beneficial_owners: [],
  dossiers: [], invoices: [], receipts: [], advances: [], aliases: [], duplicate_candidates: [], pending_changes: [],
};

const ROUTES = {
  "/clients/c1/360": { party: { client_id: "c1", ...PARTY }, ...REST },
  "/suppliers/s1/360": { party: { supplier_id: "s1", ...PARTY }, ...REST },
  "/clients/c1/account-manager": {
    client_id: "c1",
    manager: { user_id: "u-awa", name: "Awa Ndiaye", job_title: "Key account manager", email: null, employee_id: "e-awa", reachable: true },
  },
  "/party-document-types": [],
  "/portal/chat/threads": [],
  "/portal/chat/messages": { thread: "general", dossier_ref: null, has_more: false, messages: [] },
};

beforeEach(() => {
  access.inbox = true;
});

describe("a client's 360 · account manager and Messages", () => {
  it("shows who looks after the client on the Overview", async () => {
    renderScreen(<PartyDossier kind="client" partyId="c1" onEdit={() => {}} />, { routes: ROUTES });
    expect(await screen.findByText("Awa Ndiaye")).toBeInTheDocument();
    expect(screen.getByText("Key account manager")).toBeInTheDocument();
  });

  it("opens the client's conversations on the Messages tab", async () => {
    const user = userEvent.setup();
    renderScreen(<PartyDossier kind="client" partyId="c1" onEdit={() => {}} />, { routes: ROUTES });
    await user.click(await screen.findByRole("button", { name: /^Messages/ }));
    // The same panel as the Client inbox: the conversation chips and the reply box.
    expect(await screen.findByRole("radiogroup", { name: "Conversation" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /General/ })).toBeInTheDocument();
    expect(await screen.findByText("Awa Ndiaye")).toBeInTheDocument();
  });

  it("offers no Messages tab without the Client inbox permission, even by link", async () => {
    access.inbox = false;
    renderScreen(<PartyDossier kind="client" partyId="c1" onEdit={() => {}} />, { routes: ROUTES, path: "/?tab=Messages" });
    // The link falls back to the Overview rather than a tab of refusals.
    expect(await screen.findByText("Compliance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Messages/ })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Conversation" })).toBeNull();
  });

  it("gives a supplier neither", async () => {
    renderScreen(<PartyDossier kind="supplier" partyId="s1" onEdit={() => {}} />, { routes: ROUTES });
    expect(await screen.findByText("Compliance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Messages/ })).toBeNull();
    expect(screen.queryByText("Account manager")).toBeNull();
  });
});
