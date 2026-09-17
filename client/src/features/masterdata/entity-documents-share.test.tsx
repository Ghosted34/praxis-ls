/**
 * Corporate entities → Documents: sharing the selection.
 *
 * The backlog item was "a Share document button that attaches selected corporate
 * docs to an email draft", and the two halves of it are asserted here against
 * the real dossier: the tab mounts the selection, and each route does the thing
 * it claims. The ZIP route is exercised through the REAL `fetchVaultDoc` +
 * `lib/zip` pair (with the network faked), because "downloads a folder" that
 * produces a file the operator cannot open is the failure worth catching — a
 * spy on `buildZip` would pass on an empty archive.
 *
 * The mail route stops at `NewMessageDialog`, which is stubbed: it is the ONE
 * compose wrapper in the product and its own tests cover mailbox picking and the
 * send. What this file has to prove is that the selected vault ids arrive there
 * — an empty `vaultAttachments` is the bug where the message goes out with a
 * note and nothing attached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

/** The composer, stubbed down to what it was handed. */
vi.mock("@/features/comms/inbox/composer/new-message", () => ({
  NewMessageDialog: (props: {
    vaultAttachments?: { vault_id: string; filename?: string | null }[];
    entityRef?: string | null;
  }) => (
    <div data-testid="composer">
      <span data-testid="composer-ref">{props.entityRef}</span>
      <span data-testid="composer-vaults">
        {JSON.stringify(props.vaultAttachments || [])}
      </span>
    </div>
  ),
}));

/** The vault, faked at the one call the ZIP path makes. */
vi.mock("@/lib/vault-file", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/vault-file")>();
  return {
    ...real,
    fetchVaultDoc: vi.fn(async (id: string) =>
      new Blob([`payload for ${id}`], { type: "application/pdf" }),
    ),
  };
});

import { fetchVaultDoc } from "@/lib/vault-file";
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
  establishments: [],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-09-17",
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
    as_of: "2026-09-17",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};

const ACF = {
  document_id: "d1",
  document_type_name: "Attestation de Conformité Fiscale",
  title: "ACF 2026",
  document_number: "SLAS-DOC-2026-00001",
  scan_status: "VERIFIED",
  verification_status: "VERIFIED",
  vault_id: "vault-acf",
  is_active: true,
};
const RCCM = {
  document_id: "d2",
  document_type_name: "Business Licence / RCCM",
  title: "RCCM",
  document_number: "SLAS-DOC-2026-00003",
  scan_status: "VERIFIED",
  verification_status: "VERIFIED",
  vault_id: "vault-rccm",
  is_active: true,
};
/** Paper only — it can be selected, and the send must say it is not travelling. */
const RIB = {
  document_id: "d3",
  document_type_name: "Bank Attestation / RIB",
  title: "RIB",
  document_number: "SLAS-DOC-2026-00002",
  scan_status: "PENDING",
  verification_status: "PENDING",
  vault_id: null,
  physical_ref: "Box A-12",
  is_active: true,
};

const openDocuments = async (documents: unknown[]) => {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: {
      "/entities/e1/360": { ...BASE, documents },
      "/party-document-types": [],
    },
  });
  await user.click(await screen.findByRole("button", { name: /^documents$/i }));
  return user;
};

/** The anchor `saveZip` clicks is synthetic — jsdom has no download. */
let downloads: string[] = [];
beforeEach(() => {
  downloads = [];
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:zip"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Corporate entities · Documents — sharing a selection", () => {
  it("offers no Share affordance until something is ticked", async () => {
    await openDocuments([ACF, RCCM]);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select ACF 2026" }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  it("selects every row from the header box, mixed state included", async () => {
    const user = await openDocuments([ACF, RCCM]);
    const all = screen.getByRole("checkbox", {
      name: "Select all documents",
    }) as HTMLInputElement;

    await user.click(screen.getByRole("checkbox", { name: "Select RCCM" }));
    // One of two: neither checked nor unchecked, and the DOM property is the
    // only way to say so.
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);

    await user.click(all);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
  });

  it("hands the selected vault ids to the mail composer", async () => {
    const user = await openDocuments([ACF, RCCM]);
    await user.click(screen.getByRole("checkbox", { name: "Select ACF 2026" }));
    await user.click(screen.getByRole("checkbox", { name: "Select RCCM" }));
    await user.click(screen.getByRole("button", { name: "Share" }));

    // The dialog lists what goes and offers exactly the two routes the request
    // named.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ACF 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("RCCM")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Download ZIP" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Send by email" }));

    const composer = await screen.findByTestId("composer");
    expect(composer).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("composer-vaults").textContent || "[]"))
      .toEqual([
        { vault_id: "vault-acf", filename: "ACF 2026" },
        { vault_id: "vault-rccm", filename: "RCCM" },
      ]);
    // Filed against the entity, so the message shows on its thread rather than
    // floating in the inbox.
    expect(screen.getByTestId("composer-ref").textContent).toBe(
      "corporate_entity:e1",
    );
  });

  it("names a document that has no scan instead of silently dropping it", async () => {
    const user = await openDocuments([ACF, RIB]);
    await user.click(screen.getByRole("checkbox", { name: "Select ACF 2026" }));
    await user.click(screen.getByRole("checkbox", { name: "Select RIB" }));
    await user.click(screen.getByRole("button", { name: "Share" }));

    expect(
      await screen.findByText(/have no scan on file and cannot be sent/i),
    ).toBeInTheDocument();
  });

  it("downloads the selection as one ZIP archive", async () => {
    const user = await openDocuments([ACF, RCCM]);
    await user.click(screen.getByRole("checkbox", { name: "Select ACF 2026" }));
    await user.click(screen.getByRole("checkbox", { name: "Select RCCM" }));
    await user.click(screen.getByRole("button", { name: "Share" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Download ZIP",
      }),
    );

    await waitFor(() => expect(downloads).toEqual(["SLAS-documents.zip"]));
    // Both files were fetched from the vault — the archive is not a rename of
    // whatever happened to be in memory.
    expect(vi.mocked(fetchVaultDoc).mock.calls.map(([id]) => id).sort()).toEqual([
      "vault-acf",
      "vault-rccm",
    ]);
    // The dialog closes on success, so the operator is not left looking at a
    // question they already answered.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
