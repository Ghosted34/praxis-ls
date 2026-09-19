/**
 * Letterhead studio → entity dossier deep links.
 *
 * Two halves, because the link had two ways to be dead and both were:
 *
 * 1. THE ROUTE. `jump()` navigated to `/master/entities/:id?tab=&field=`, but
 *    app.tsx declares `master/corporate-entities/:entityId` — every
 *    "Edit in X →" landed on the catch-all redirect to "/". Pinned here by
 *    asserting the URL the studio actually assigns.
 *
 * 2. THE LANDING. `?field=` is only worth sending if the dossier rings
 *    something for it. The studio sends the catalogue's logical names
 *    (address_registered, legal_form, contact, registrations, establishments,
 *    treasury_accounts) and the dossier carries each as a `data-field` anchor
 *    on the section that owns the fact — so the jump lands ON the thing, not
 *    just the tab. Pinned by mounting the dossier at the very URL the studio
 *    builds and asserting the highlight ring lands on the anchor.
 *
 * (The server side of the same contract — every catalogue tab/field resolves
 * to a real anchor — is gated in tests/unit/letterhead-blocks.test.js.)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { LetterheadStudio } from "./letterhead-studio";
import { EntityDossier } from "./entity-360";
import type * as api from "@/lib/masterdata-api";

/* ── the studio, with one footer block fed by another tab ────────────────── */

const CONFIG = {
  entity_id: "e1",
  show_legal_form: true,
  show_share_capital: true,
  show_registered_address: true,
  show_registrations: true,
  show_contact: true,
  show_bank_block: true,
  show_establishment: true,
  logo_position: "LEFT",
  paper_size: "A4",
} as api.LetterheadConfig;

const IDENTIFIERS_BLOCK = {
  id: "identifiers",
  row: 0,
  col: 0,
  span: 12,
  align: "left",
  size: 1,
  zone: "footer",
  kind: "text",
  weight: "normal",
  tone: "ink",
  transform: "none",
  visible: true,
  custom: false,
  authored: false,
  fixed: false,
  empty: false,
  label: { fr: "Identifiants fiscaux et commerciaux", en: "Tax & trade identifiers" },
  hint: { fr: "", en: "" },
  source: { tab: "Identity & registrations", field: "registrations" },
  toggle: ["show_registrations"],
  lines: [{ type: "text", text: "NIU M042116033580Q" }],
} as api.LetterheadBlock;

const COMPOSITION = {
  language: "fr",
  header: [],
  footer: [IDENTIFIERS_BLOCK],
  empty_blocks: [],
  height: { header_mm: 0, footer_mm: 3.6 },
} as api.LetterheadComposition;

const BUNDLE = {
  config: CONFIG,
  remittance_account_id: null,
  treasury_accounts: [],
  preview: {} as api.LetterheadBundle["preview"],
  blocks: { fr: COMPOSITION, en: { ...COMPOSITION, language: "en" } },
  custom_lines: [],
  catalogue: [],
  tokens: [],
  language: "fr",
} as api.LetterheadBundle;

const originalLocation = window.location;
afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    configurable: true,
    writable: true,
  });
});

describe("Letterhead studio · the 'Edit in X →' link", () => {
  it("navigates to the dossier's REAL route with the block's tab and field", async () => {
    // jsdom refuses real navigation; the assertion is the URL handed to it.
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign },
      configurable: true,
      writable: true,
    });

    const user = userEvent.setup();
    renderScreen(
      <LetterheadStudio
        entityId="e1"
        bundle={BUNDLE}
        lang="fr"
        onLang={() => {}}
        onReload={() => {}}
        onSaved={() => {}}
      />,
      { routes: {} },
    );

    // Select the identifiers block on the canvas, then follow its deep link.
    await user.click(
      screen.getByRole("button", { name: /Identifiants fiscaux/ }),
    );
    await user.click(
      screen.getByRole("button", { name: /Edit in Identity & registrations/ }),
    );

    expect(assign).toHaveBeenCalledTimes(1);
    const url = assign.mock.calls[0][0] as string;
    // The route app.tsx serves — NOT /master/entities/…, which no route
    // declares and which the catch-all bounced to "/".
    expect(url).toMatch(/^\/master\/corporate-entities\/e1\?/);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tab")).toBe("Identity & registrations");
    expect(params.get("field")).toBe("registrations");
  });
});

/* ── the dossier, mounted at the URL the studio builds ───────────────────── */

/** Minimal entity 360 (same shape entity-kpi-drill.test.tsx uses). */
const ENTITY_360 = {
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
    is_group_parent: false,
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
    as_of: "2026-07-01",
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
  can_see_governance: false,
  capabilities: { view: true, edit: true, approve: false, public_story: false },
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
  renewals: { as_of: "2026-07-01", items: [], counts: { expired: 0, due: 0, approaching: 0 } },
};

describe("Entity dossier · landing on the studio's deep link", () => {
  it.each([
    ["Identity & registrations", "registrations"],
    ["Contacts & addresses", "address_registered"],
    ["Overview", "legal_form"],
    ["Overview", "contact"],
    ["Structure", "establishments"],
    ["Banking & treasury", "treasury_accounts"],
  ])("?tab=%s&field=%s rings the owning section, not just the tab", async (tab, field) => {
    renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
      routes: { "/entities/e1/360": ENTITY_360 },
      path: `/?tab=${encodeURIComponent(tab)}&field=${encodeURIComponent(field)}`,
    });

    // The anchor exists on the landed tab…
    await waitFor(() => {
      expect(document.querySelector(`[data-field="${field}"]`)).not.toBeNull();
    });
    // …and the highlight actually lands ON it — the ring is what tells the
    // reader which of the sections was meant.
    await waitFor(() => {
      expect(
        document.querySelector(`[data-field="${field}"]`)!.classList.contains(
          "praxis-field-highlight",
        ),
      ).toBe(true);
    });
  });
});
