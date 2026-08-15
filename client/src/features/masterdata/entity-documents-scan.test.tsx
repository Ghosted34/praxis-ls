/**
 * Corporate entities → Documents: the attachment UI, asserted against the real
 * dossier rather than against the component in isolation.
 *
 * WHY SEPARATELY FROM `scan-attachment.test.tsx`. That file proves the control
 * behaves; this one proves the entity register actually MOUNTS it, on the tab
 * where an operator would look for it, and that the row reflects what the file
 * did to the record. A shared component with no call site is exactly the failure
 * mode `check-docs.mjs` exists to prevent, one layer up.
 *
 * It also pins the thing the tab is most often misread for. The attachment lives
 * on the ROW, so an entity with no documents yet shows no upload control at all
 * — the file is attached after the record is created, deliberately (a
 * certificate you are holding must be recordable before it has been scanned).
 * That is a real property of the screen, not an oversight, and the empty state
 * has to say so; if someone deletes that sentence, this fails.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { EntityDossier } from "./entity-360";

const BASE = {
  entity: {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    legal_form: "SARL",
    country_code: "CM",
    registration_status: "ACTIVE",
    is_active: true,
    default_currency: "XAF",
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: true,
    ancestors: [],
    children: [],
  },
  people: [],
  contacts: [],
  addresses: [],
  registrations: [],
  establishments: [
    {
      establishment_id: "es1",
      name: "Siège social",
      kind: "HEAD_OFFICE",
      city: "Douala",
    },
  ],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-07-01",
    holder_count: 0,
    total_percent: 0,
    total_shares: 0,
    issued_capital: 0,
    balanced: true,
    findings: [],
  },
  usage: {
    journal_entries: 0,
    employees: 0,
    treasury_accounts: 0,
    subsidiaries: 0,
  },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  letterhead_config: null,
  letterhead_source: {},
  letterhead_preview: {
    language: "fr",
    paper_size: "A4",
    logo_position: "LEFT",
    header: {},
    footer: {},
    payment_block: { source: "none", accounts: [] },
    identifiers: [],
    empty_blocks: [],
  },
  renewals: {
    as_of: "2026-07-01",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};

const PAPER_ONLY = {
  document_id: "d1",
  document_type_id: "dt1",
  document_type_name: "Certificate of incorporation",
  title: "Certificat d'incorporation",
  document_number: "RC/DLA/2021/B/206",
  country_code: "CM",
  expires_on: null,
  physical_ref: "Box A-12",
  scan_status: "PENDING",
  vault_id: null,
  is_active: true,
};
const SCANNED = {
  ...PAPER_ONLY,
  document_id: "d2",
  title: "Attestation de non-redevance",
  scan_status: "SCANNED",
  vault_id: "vault-1",
  physical_ref: null,
};

const routes = (documents: unknown[]) => ({
  "/entities/e1/360": { ...BASE, documents },
  "/party-document-types": [
    {
      document_type_id: "dt1",
      code: "INCORPORATION",
      name: "Certificate of incorporation",
    },
  ],
});

const openDocuments = async (documents: unknown[]) => {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: routes(documents),
  });
  await user.click(await screen.findByRole("button", { name: /^documents$/i }));
  return user;
};

describe("Corporate entities · Documents — attaching a file", () => {
  it("offers a file input on a paper-only row, accepting a PDF or an image", async () => {
    await openDocuments([PAPER_ONLY]);

    const input = await screen.findByLabelText("Attach scan");
    expect(input).toHaveAttribute("type", "file");
    // The formats the vault stores a scan as. Anything else is a different kind
    // of document and does not belong on a certificate row.
    expect(input.getAttribute("accept")).toBe(
      "application/pdf,image/png,image/jpeg,image/webp",
    );
  });

  it("offers the file back once one is attached, and stops calling it missing", async () => {
    await openDocuments([SCANNED]);

    expect(
      await screen.findByRole("button", { name: "View" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Replace")).toHaveAttribute("type", "file");
    // The pill follows `scan_status`, which the API advances by itself once
    // `vault_id` lands — no second control, and nothing left saying "Paper".
    const row = screen
      .getByText("Attestation de non-redevance")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("Scanned")).toBeInTheDocument();
    expect(within(row).queryByText("Paper")).toBeNull();
  });

  it("tells an operator with no documents yet where the file goes", async () => {
    await openDocuments([]);

    // No row yet, so no row-level attachment control — the empty state has to
    // point at where the file goes (the Add document form, or the row later)
    // instead of leaving the tab looking like a dead end.
    expect(screen.queryByLabelText("Attach scan")).toBeNull();
    expect(
      await screen.findByText(/attach the file later from the row/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add document/i }),
    ).toBeInTheDocument();
  });
});

describe("Corporate entities · Documents — the Add document form", () => {
  const openForm = async () => {
    const user = await openDocuments([]);
    await user.click(
      await screen.findByRole("button", { name: /add document/i }),
    );
    expect(
      await screen.findByRole("heading", { name: "Add document" }),
    ).toBeInTheDocument();
    return user;
  };

  it("drops the API jargon and the Scan-due field", async () => {
    await openForm();
    expect(screen.queryByText(/left unset/i)).toBeNull();
    expect(screen.queryByText(/scan due/i)).toBeNull();
  });

  it("system-generates the reference number, shows dates day-first, and takes the file inline", async () => {
    await openForm();

    expect(screen.getByLabelText(/^Reference number/i)).toHaveValue(
      "Assigned on save",
    );
    expect(screen.getByLabelText(/^Reference number/i)).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByText(/generated automatically/i)).toBeInTheDocument();

    // "Issued on" carries no hint, so its label text is exactly the field name.
    expect(screen.getByLabelText("Issued on")).toHaveAttribute(
      "placeholder",
      "dd/mm/yyyy",
    );

    const file = screen.getByLabelText("Document file");
    expect(file).toHaveAttribute("type", "file");
    expect(file.getAttribute("accept")).toBe(
      "application/pdf,image/png,image/jpeg,image/webp",
    );
  });
});
