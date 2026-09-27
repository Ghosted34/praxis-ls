/**
 * 17 Sep review, M4-B6 — the first "where it operates" input lost focus after
 * every keystroke.
 *
 * The rows were keyed on `${country_code}-${index}`, and the first input in a
 * row edits `country_code`: type "C", the key changes, React unmounts the row
 * and mounts a new one, and the caret is gone. Typing "CM" took two clicks.
 * The rows now carry a local id that never changes while they are on screen,
 * so the assertion here is the simplest possible one — type two characters
 * into the fresh row and both land, with the input still focused.
 *
 * The second test pins the reason the id is not just the index: removing a
 * middle row must leave the rows below it intact rather than shifting their
 * keys onto the wrong DOM.
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

const story = (public_coverage: unknown[] = []) => ({
  entity_id: "e1",
  code: "SLAS",
  legal_name: "Smart Logistics & Services Ltd",
  trading_name: null,
  country_code: "CM",
  registration_status: "ACTIVE",
  public_enabled: true,
  public_summary_fr: "Un réseau logistique.",
  public_summary_en: "A logistics network.",
  public_coverage,
  public_focus: [],
  public_cover_vault_id: null,
  cover_attachment: null,
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

async function openStoryTab(public_coverage: unknown[] = []) {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: {
      "/entities/e1/360": dossier,
      "/site-settings/entities/e1/story": story(public_coverage),
      "/site-settings/service-types": [],
    },
  });
  await user.click(await screen.findByRole("button", { name: /^public story$/i }));
  await screen.findByRole("button", { name: /add a place/i });
  return user;
}

describe("Corporate entities · Public story — where it operates", () => {
  it("keeps focus in the country-code box across keystrokes", async () => {
    const user = await openStoryTab();

    await user.click(screen.getByRole("button", { name: /add a place/i }));
    const code = screen.getByRole("textbox", { name: /country code/i });
    await user.click(code);
    await user.keyboard("cm");

    // Both characters landed in the SAME element, upper-cased, and it is
    // still the active element — a remounted row would have swallowed the
    // second keystroke and left focus on <body>.
    expect(code).toHaveValue("CM");
    expect(document.activeElement).toBe(code);
  });

  it("shows each place input's expected shape as a placeholder", async () => {
    const user = await openStoryTab();
    await user.click(screen.getByRole("button", { name: /add a place/i }));

    expect(screen.getByRole("textbox", { name: /country code/i })).toHaveAttribute(
      "placeholder",
      "CM",
    );
    expect(screen.getByRole("textbox", { name: /label \(fr\)/i })).toHaveAttribute(
      "placeholder",
    );
    expect(screen.getByRole("textbox", { name: /label \(en\)/i })).toHaveAttribute(
      "placeholder",
    );
  });

  it("removes the row that was asked for, and only that one", async () => {
    const user = await openStoryTab([
      { country_code: "CM", label_fr: "Douala", label_en: "Douala" },
      { country_code: "GA", label_fr: "Libreville", label_en: "Libreville" },
      { country_code: "TD", label_fr: "N'Djamena", label_en: "N'Djamena" },
    ]);

    const rows = () =>
      screen
        .getAllByRole("textbox", { name: /country code/i })
        .map((el) => (el as HTMLInputElement).value);
    expect(rows()).toEqual(["CM", "GA", "TD"]);

    const middle = screen.getAllByRole("listitem")[1];
    await user.click(within(middle).getByRole("button", { name: /remove/i }));

    expect(rows()).toEqual(["CM", "TD"]);
    // The row that stayed still holds ITS labels, not the removed row's.
    expect(screen.getAllByRole("textbox", { name: /label \(en\)/i })[1]).toHaveValue(
      "N'Djamena",
    );
  });
});
