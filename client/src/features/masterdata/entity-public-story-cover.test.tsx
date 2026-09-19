/**
 * PR-07 (CE-25) — the durable half of a failed cover upload.
 *
 * The upload control already surfaces the error WHILE the operator is looking
 * at it. What this file pins is the state that outlives the modal: a
 * replacement whose pointer transaction failed leaves the previous cover
 * serving and the attempt parked in the attachment outbox, and the Story tab
 * has to SAY so — "the upload did not take" on the screen, not in a console.
 *
 * The banner disappears with the problem: `cover_attachment` is null once the
 * last attempt links or is reconciled, and a banner that outlives its problem
 * is a banner operators stop reading.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { EntityDossier } from "./entity-360";

const story = (cover_attachment: unknown = null) => ({
  entity_id: "e1",
  code: "SLAS",
  legal_name: "Smart Logistics & Services Ltd",
  trading_name: null,
  country_code: "CM",
  registration_status: "ACTIVE",
  public_enabled: true,
  public_summary_fr: "Un réseau logistique.",
  public_summary_en: "A logistics network.",
  public_coverage: [],
  public_focus: [],
  public_cover_vault_id: "11111111-1111-1111-1111-111111111111",
  cover_attachment,
});

const dossier = {
  entity: {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
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
    as_of: "2026-09-19",
    holder_count: 0,
    total_percent: 0,
    total_shares: 0,
    issued_capital: 0,
    balanced: true,
    findings: [],
  },
  usage: { journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  capabilities: { view: true, edit: true, approve: false, public_story: true },
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
    as_of: "2026-09-19",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};

async function openStoryTab(cover_attachment: unknown) {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: {
      "/entities/e1/360": dossier,
      "/site-settings/entities/e1/story": story(cover_attachment),
      "/site-settings/service-types": [],
    },
  });
  await user.click(
    await screen.findByRole("button", { name: /^public story$/i }),
  );
  return user;
}

describe("Corporate entities · Public story — a cover upload that did not take", () => {
  it("says so on the screen, with the error and what is still serving", async () => {
    await openStoryTab({
      state: "FAILED",
      vault_doc_id: "22222222-2222-2222-2222-222222222222",
      attempts: 1,
      last_error: "boom (injected)",
      updated_at: "2026-09-18T14:03:00.000Z",
    });

    expect(
      await screen.findByText("The last cover upload did not take"),
    ).toBeInTheDocument();
    // The error verbatim — the operator can tell a wrong file from a dead
    // network, which a generic "failed" never lets them do.
    expect(screen.getByText(/boom \(injected\)/)).toBeInTheDocument();
    // And the honest byte-count: the file reached storage, was never
    // published, and the cover above is still the previous one.
    expect(
      screen.getByText(/never published, so the cover shown above is still the previous one/i),
    ).toBeInTheDocument();
  });

  it("names an interrupted upload without claiming a file was stored", async () => {
    await openStoryTab({
      state: "INTENT",
      vault_doc_id: null,
      attempts: 0,
      last_error: null,
      updated_at: "2026-09-19T09:00:00.000Z",
    });

    expect(
      await screen.findByText("The last cover upload did not take"),
    ).toBeInTheDocument();
    expect(screen.getByText(/interrupted before it finished/i)).toBeInTheDocument();
    // vault_doc_id is null — the banner must not claim bytes exist.
    expect(screen.queryByText(/reached storage/i)).toBeNull();
  });

  it("shows no banner once the last attempt linked or was reconciled", async () => {
    await openStoryTab(null);
    // The cover slot renders (there is a live cover to preview)…
    expect(
      await screen.findByAltText("Current image"),
    ).toBeInTheDocument();
    // …and no banner: LINKED and RECONCILED are history, not warnings.
    expect(
      screen.queryByText("The last cover upload did not take"),
    ).toBeNull();
  });
});
