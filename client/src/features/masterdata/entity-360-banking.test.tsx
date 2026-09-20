/**
 * PR-10 / A0 + A5 — the Banking & treasury tab shows THE primary account.
 *
 * The binding decisions, as tests:
 *
 *   A0  bank_name / account_number / holder name are VISIBLE to every MOD-01
 *       viewer on this tab (the server no longer masks them for the 360
 *       surface — pinned server-side in tests/unit/entity-primary-account.test.js;
 *       this file pins the CLIENT half: what the tab actually renders).
 *   A1  ONE resolver decides the primary. A tenant with six accounts gets ONE
 *       detailed row, never six; "unset"/"ambiguous" render the explicit
 *       "No primary account selected" hint with a way through to Treasury.
 *   A5  The non-primary accounts stay discoverable (a count + link) without
 *       their identifiers being printed beside the primary's; the tab stays
 *       read-only (no second editing form) and keeps its deep link.
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

const PRIMARY = {
  treasury_account_id: "ta1",
  kind: "BANK",
  label: "Afriland — Main XAF",
  coa_code: "521101",
  currency: "XAF",
  bank_name: "Afriland First Bank",
  branch: "Douala Central",
  account_number: "10005000123456",
  iban: "CM21100030000100200456",
  swift_bic: "CCEICMCX",
  holder_name: "SmartBox SARL",
  is_active: true,
  is_primary: true,
  show_on_documents: true,
};

const OTHERS = [2, 3, 4, 5, 6].map((n) => ({
  ...PRIMARY,
  treasury_account_id: `ta${n}`,
  label: `Other bank ${n}`,
  bank_name: `Bank ${n}`,
  account_number: `${n}`.repeat(10),
  holder_name: `Holder ${n}`,
  is_primary: false,
}));

const dossier = ({
  accounts = [PRIMARY, ...OTHERS],
  primary,
}: {
  accounts?: typeof PRIMARY[];
  primary?: object;
} = {}) => ({
  entity: {
    entity_id: "e1",
    code: "SBX",
    legal_name: "SmartBox SARL",
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
  treasury_accounts: accounts,
  // The server resolver's answer — the tab renders THIS, not its own guess.
  treasury_primary:
    primary !== undefined
      ? primary
      : { state: "account", account: PRIMARY },
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
  usage: {
    journal_entries: 0,
    employees: 0,
    treasury_accounts: 0,
    subsidiaries: 0,
  },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  capabilities: { view: true, edit: false, approve: false, public_story: false },
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
});

async function openBankingTab(data: ReturnType<typeof dossier>) {
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: { "/entities/e1/360": data },
  });
  await user.click(
    await screen.findByRole("button", { name: /banking & treasury/i }),
  );
  return user;
}

describe("Corporate entities · Banking & treasury tab (PR-10)", () => {
  it("shows the PRIMARY account's full identity — bank, number and holder (A0/A5)", async () => {
    await openBankingTab(dossier());

    // One primary row, carrying every field the owner listed.
    const row = screen
      .getByText("Afriland — Main XAF")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("Afriland First Bank")).toBeInTheDocument();
    expect(within(row).getByText("10005000123456")).toBeInTheDocument();
    expect(within(row).getByText("SmartBox SARL")).toBeInTheDocument();
    expect(within(row).getByText("521101")).toBeInTheDocument();
    expect(within(row).getByText("XAF")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByText("Primary")).toBeInTheDocument();
  });

  it("six accounts print ONE bank row — the others are a count, never their identifiers", async () => {
    await openBankingTab(dossier());

    // The primary's number prints exactly once…
    expect(screen.getAllByText("10005000123456")).toHaveLength(1);
    // …and no other account's number or holder appears anywhere on the tab.
    expect(screen.queryByText("2222222222")).toBeNull();
    expect(screen.queryByText("Holder 3")).toBeNull();
    // The discoverability affordance: a count and a way through.
    expect(screen.getByText(/5 other account/i)).toBeInTheDocument();
  });

  it("keeps the read-only posture and the Treasury deep link", async () => {
    await openBankingTab(dossier());

    // The section's deep link survives (and the count affordance carries its
    // own way through, so more than one matching control is expected).
    const links = screen.getAllByRole("button", { name: /open treasury/i });
    expect(links.length).toBeGreaterThan(0);
    // Read-only: no second editing form appears for the accounts here.
    expect(
      screen.queryByRole("button", { name: /^add account/i }),
    ).toBeNull();
    expect(screen.queryByLabelText(/account number/i)).toBeNull();
  });

  it("no primary selected: the explicit hint, deep-linking to Treasury — no fake rows", async () => {
    await openBankingTab(
      dossier({
        accounts: [PRIMARY, ...OTHERS].map((a) => ({ ...a, is_primary: false })),
        primary: { state: "unset", account: null },
      }),
    );

    expect(
      screen.getByText("No primary account selected"),
    ).toBeInTheDocument();
    // The hint carries its own way through, beside the section's button.
    expect(screen.getAllByRole("button", { name: /open treasury/i }).length)
      .toBeGreaterThan(0);
    // No account identifiers printed as if one of them had been chosen.
    expect(screen.queryByText("10005000123456")).toBeNull();
  });

  it("ambiguous primaries name the problem, and still print nothing", async () => {
    await openBankingTab(
      dossier({ primary: { state: "ambiguous", account: null } }),
    );

    expect(screen.getByText("No primary account selected")).toBeInTheDocument();
    expect(
      screen.getByText(/several accounts are flagged primary/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("10005000123456")).toBeNull();
    expect(screen.queryByText("2222222222")).toBeNull();
  });

  it("a tenant with no accounts at all keeps the empty state", async () => {
    await openBankingTab(
      dossier({
        accounts: [],
        primary: { state: "unset", account: null },
      }),
    );

    expect(
      screen.getByText("No treasury accounts for this entity"),
    ).toBeInTheDocument();
  });
});
