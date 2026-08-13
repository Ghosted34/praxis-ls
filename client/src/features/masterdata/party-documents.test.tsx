/**
 * Clients / Suppliers → Documents: the "Add document" form, asserted against the
 * real dossier.
 *
 * WHAT CHANGED, AND WHY THIS GUARDS IT. Adding a KYC document used to be two
 * errands — save the row through a generic modal, then hunt it down and attach
 * the PDF from a second control on the row — under a header of API jargon
 * ("Fields marked on the master form as required are enforced by the API") and a
 * "Scan due" date nobody filled in. This proves the form now: carries no jargon
 * and no Scan-due field, renders its dates day-first (dd/mm/yyyy) rather than in
 * the browser locale, and takes the file inline so one submit both records the
 * document and attaches its scan.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { PartyDossier } from "./party-360";

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
    outstanding: 0, overdue: 0, oldest_due_date: null,
    credit_limit: 5_000_000, credit_available: 5_000_000,
    ytd_revenue: 0, dossiers_in_progress: 0,
    aging: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  },
  compliance: { compliance_state: "OK", can_verify: false, flags: [] },
  gl_parity: { ok: true, ledger: 0, subledger: 0, delta: 0 },
  contacts: [], addresses: [], banks: [], documents: [], registrations: [], beneficial_owners: [],
  dossiers: [], invoices: [], receipts: [], advances: [],
  aliases: [], duplicate_candidates: [], pending_changes: [],
};

const routes = (extra: Record<string, unknown> = {}) => ({
  "/clients/c1/360": CLIENT_360,
  "/party-document-types": [{ document_type_id: "dt1", code: "NIU", name: "Tax ID (NIU)" }],
  ...extra,
});

const pdf = (name = "clearance.pdf", size = 1024) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" });

const openAddDocument = async (extra?: Record<string, unknown>) => {
  const user = userEvent.setup();
  renderScreen(<PartyDossier kind="client" partyId="c1" onEdit={() => {}} />, { routes: routes(extra) });
  await user.click(await screen.findByRole("button", { name: /^Documents/i }));
  await user.click(await screen.findByRole("button", { name: "+ Add" }));
  // The dialog title, not the submit button of the same words.
  expect(await screen.findByRole("heading", { name: "Add document" })).toBeInTheDocument();
  return user;
};

describe("Clients · Documents — the Add document form", () => {
  it("drops the API jargon and the Scan-due field", async () => {
    await openAddDocument();

    expect(screen.queryByText(/enforced by the API/i)).toBeNull();
    expect(screen.queryByText(/^Scan due$/i)).toBeNull();
    // The fields that remain.
    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.getByLabelText("Number")).toHaveValue("Assigned on save");
    expect(screen.getByLabelText("Number")).toHaveAttribute("readonly");
    expect(screen.getByText(/generated automatically/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Physical archive ref")).toBeInTheDocument();
  });

  it("shows the dates day-first and takes the file inline", async () => {
    const user = await openAddDocument();

    const issued = screen.getByLabelText("Issued");
    expect(issued).toHaveAttribute("placeholder", "dd/mm/yyyy");
    // Typed month-day-year in a US locale would land on the wrong day; here the
    // control reads what the operator typed — 3 July, not 7 March.
    await user.type(issued, "03072026");
    expect(issued).toHaveValue("03/07/2026");

    const file = screen.getByLabelText("Document file");
    expect(file).toHaveAttribute("type", "file");
    expect(file.getAttribute("accept")).toBe("application/pdf,image/png,image/jpeg,image/webp");
  });

  it("records the document and attaches the file in one submit", async () => {
    const user = await openAddDocument({
      "/clients/c1/documents": { document_id: "newdoc1" }, // create returns the row
      "/documents": { doc_id: "vault-1" }, // vault upload returns the file id
    });

    await user.upload(screen.getByLabelText("Document file"), pdf());
    await user.click(screen.getByRole("button", { name: /^Add document$/i }));

    // The success toast only reads "scan attached" when the file branch ran to
    // completion after the record was created.
    expect(await screen.findByText(/scan attached/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add document" })).toBeNull());
  });
});
