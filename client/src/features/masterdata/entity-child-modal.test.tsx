/**
 * The entity dossier's nested add/edit modals — accessibility and coverage.
 *
 * WHY THIS FILE EXISTS. `screens.axe.test.tsx` renders every screen in four
 * states and runs axe over each, which is what caught the dossier's heading
 * order. It cannot catch anything behind a button: it never opens a modal. So
 * the largest forms in this module — the ones this work just doubled in size —
 * had no accessibility coverage at all, and the first defect found by reading
 * the diff back was exactly there: `role_tags` rendered a `<fieldset>` inside
 * the generic `<label>` wrapper, which is invalid, and made the field's label
 * toggle whichever checkbox happened to be first.
 *
 * WHAT IT ASSERTS. That the two field types added here render clean and
 * labelled — the multiselect group and the pickers built from lookups — and that
 * the collection with the most fields is axe-clean when open. It also pins the
 * `is_active` default, because "the box is unticked but the record is created
 * active" is the kind of wrong that nobody reports and everybody works around.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { EntityDossier } from "./entity-360";

const ENTITY_360 = {
  entity: {
    entity_id: "e1", code: "SBX", legal_name: "SmartBox SARL", legal_form: "SARL",
    country_code: "CM", registration_status: "ACTIVE", is_active: true,
    share_capital: 10_000_000, share_capital_currency: "XAF", default_currency: "XAF",
    logo_light_ref: "/media/smartbox.png",
  },
  structure: {
    parent_entity_id: null, relationship_type: null, ownership_percent: null,
    consolidates: false, is_group_parent: true, ancestors: [], children: [],
  },
  people: [],
  contacts: [{ contact_id: "ct1", name: "Comptabilité", email: "compta@smartbox.cm", role_tags: ["BILLING", "TAX"], is_primary: true }],
  addresses: [],
  registrations: [],
  establishments: [{ establishment_id: "es1", name: "Siège social", kind: "HEAD_OFFICE", city: "Douala" }],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: { as_of: "2026-07-01", holder_count: 0, total_percent: 0, total_shares: 0, issued_capital: 0, balanced: true, findings: [] },
  usage: { journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  letterhead_config: null,
  letterhead_source: {},
  letterhead_preview: { language: "fr", paper_size: "A4", logo_position: "LEFT", header: {}, footer: {}, payment_block: { source: "none", accounts: [] }, identifiers: [], empty_blocks: [] },
  renewals: { as_of: "2026-07-01", items: [], counts: { expired: 0, due: 0, approaching: 0 } },
};

/** Lookups the people modal fetches when it opens. */
const routes = {
  "/entities/e1/360": ENTITY_360,
  "/entities": [{ entity_id: "e2", code: "SBXFR", legal_name: "SmartBox France SAS" }],
  "/employees": [{ employee_id: "emp1", full_name: "Amina Ndoumbe" }],
  "/clients": [{ client_id: "c1", name: "Bolloré Transport" }],
  "/suppliers": [{ supplier_id: "s1", name: "Total Energies" }],
  "/users": [{ user_id: "u1", full_name: "Paul Mbarga" }],
  "/tax-jurisdictions": [{ jurisdiction_id: "tj1", name: "Cameroun", country_code: "CM", currency: "XAF" }],
};

const open = () => renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, { routes });

describe("Master data · entity nested modals", () => {
  it("the contacts modal offers every department tag, as a labelled group", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole("button", { name: /contacts & addresses/i }));
    await user.click(await screen.findByRole("button", { name: /add contact/i }));

    // The group is a fieldset with a visible legend, not a label wrapping ten
    // checkboxes — see this file's header for what that regression looked like.
    const group = await screen.findByRole("group", { name: /departments/i });
    // `enumLabel` sentence-cases: ACCOUNTS_PAYABLE reads "Accounts payable".
    for (const tag of ["Billing", "Customs", "Treasury", "Accounts payable"]) {
      expect(within(group).getByRole("checkbox", { name: tag })).toBeTruthy();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a new child starts Active, so the box matches the record that gets created", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /contacts & addresses/i }));
    await user.click(await screen.findByRole("button", { name: /add contact/i }));

    expect((await screen.findByRole("checkbox", { name: "Active" })).getAttribute("aria-checked")).toBe("true");
  });

  it("the people modal turns its foreign keys into pickers, not uuid boxes", async () => {
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole("button", { name: /people & shareholding/i }));
    await user.click(await screen.findByRole("button", { name: /add shareholder/i }));

    // Each of these was a column the API accepted, the dossier rendered, and no
    // control could set. A picker populated from a lookup is the proof it landed.
    const holder = await screen.findByRole("combobox", { name: /held by one of our entities/i });
    expect(within(holder).getByRole("option", { name: /SmartBox France SAS/ })).toBeTruthy();
    expect(within(await screen.findByRole("combobox", { name: /is also an employee/i })).getByRole("option", { name: "Amina Ndoumbe" })).toBeTruthy();
    expect(within(await screen.findByRole("combobox", { name: /is also a client/i })).getByRole("option", { name: "Bolloré Transport" })).toBeTruthy();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("the tax-registration modal can set the jurisdiction its table prints", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /tax & jurisdiction/i }));
    await user.click(await screen.findByRole("button", { name: /^add registration$/i }));

    // `jurisdiction_name` was rendered in the table and could never be populated,
    // because nothing could write the id it is joined from.
    const jur = await screen.findByRole("combobox", { name: /tax jurisdiction/i });
    await waitFor(() => expect(within(jur).getByRole("option", { name: /Cameroun/ })).toBeTruthy());
  });
});
