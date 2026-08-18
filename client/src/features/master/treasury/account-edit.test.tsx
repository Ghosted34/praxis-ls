/**
 * Treasury account — correcting a mistyped account.
 *
 * WHY THIS FILE EXISTS. A treasury account is the one master record that can
 * never be deleted: `treasury_account.repo` deliberately keeps the row and its
 * class-5 CoA leaf because journal history references the code. Before the
 * edit button, a treasurer who typed a 13-digit account number instead of 14,
 * or an opening balance one zero short, had no repair path in the UI at all —
 * the backend PATCH existed and nothing called it. "Deactivate it and make a
 * second one" is not a repair; it mints a second CoA leaf and splits the
 * account's history across two ledgers.
 *
 * WHAT IT ASSERTS. That Edit opens on the account's CURRENT values (a form
 * that opens blank silently re-creates the typo), that the corrected values
 * reach the wire as a PATCH, and that entity and category stay locked — the
 * two fields the service refuses, because the CoA leaf is already minted under
 * the category's parent.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

// After the mock, so this is the faked namespace — the save test spies on
// `tenant` to read the PATCH body the modal actually puts on the wire.
import * as apiClient from "@/lib/api-client";

import { TreasuryDossier } from "./dossier";

/** The account as mistyped: 13 digits instead of 14, and a 1.5M opening
 *  balance that should have been 15M. */
const ACCOUNT = {
  treasury_account_id: "t1",
  entity_id: "e1",
  category_id: "cat-bank",
  kind: "BANK",
  label: "Afriland First Bank 521-1",
  coa_code: "5211",
  currency: "XAF",
  is_active: true,
  is_primary: true,
  is_verified: false,
  verified_by: null,
  verified_at: null,
  bank_name: "Afriland First Bank",
  branch: "Douala — Bonanjo",
  account_number: "1000521000123",
  iban: null,
  swift_bic: null,
  routing_code: null,
  holder_name: "JBS Praxis",
  opening_balance: "1500000.00",
  opening_date: "2026-01-01T00:00:00.000Z",
  statement_day: null,
  custodian_user_id: null,
  location: null,
  float_limit: null,
  momo_number: null,
  momo_till: null,
  momo_agent: null,
  momo_network: null,
  momo_fee_account: null,
  category_code: "BANK",
  category_label: "Bank",
  category_requires_custodian: false,
  category_is_bank_identity: true,
  category_is_momo_identity: false,
  category_coa_parent_code: "521",
};

const CATEGORY = {
  treasury_category_id: "cat-bank",
  code: "BANK",
  label: "Bank",
  legacy_kind: "BANK",
  coa_parent_code: "521",
  requires_custodian: false,
  is_bank_identity: true,
  is_momo_identity: false,
  is_system: true,
  is_active: true,
};

const zero = { debit: 0, credit: 0, net: 0 };
const DOSSIER = {
  account: ACCOUNT,
  category: CATEGORY,
  coa_leaf: null,
  custodian: null,
  verifier: null,
  kpis: {
    opening_balance: 1500000,
    posted_net: 0,
    balance: 1500000,
    currency: "XAF",
    debit_total: 0,
    credit_total: 0,
    mtd: zero,
    ytd: zero,
    unreconciled_count: null,
  },
  last_debit: null,
  last_credit: null,
  monthly_series: [],
  recent_lines: [],
  documents: [],
  timeline: [],
  readiness: { items: [], done: 4, total: 10, percent: 40 },
};

const routes = {
  "/treasury-accounts/t1/360": DOSSIER,
  "/treasury-categories": [CATEGORY],
  "/entities": [{ entity_id: "e1", code: "JBS", legal_name: "JBS Praxis" }],
};

const open = () => renderScreen(<TreasuryDossier id="t1" />, { routes });

const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  const rendered = open();
  await user.click(await screen.findByRole("button", { name: /^edit$/i }));
  return rendered;
};

describe("Master data · treasury account editing", () => {
  it("opens on the values already stored, so a correction starts from the typo", async () => {
    const user = userEvent.setup();
    await openEditor(user);

    // PG sends numerics as strings ("1500000.00"); a number input renders that
    // as an empty box, which would silently blank the field on save.
    expect(
      (await screen.findByLabelText(/opening balance/i)).getAttribute("value"),
    ).toBe("1500000");
    expect(
      (await screen.findByLabelText(/account number/i)).getAttribute("value"),
    ).toBe("1000521000123");
    // A timestamp reaches <input type="date"> as YYYY-MM-DD or not at all.
    expect(
      (await screen.findByLabelText(/opening date/i)).getAttribute("value"),
    ).toBe("2026-01-01");
  });

  it("is axe-clean with the form open", async () => {
    // screens.axe.test.tsx renders every screen but never opens a modal, so
    // the largest form in this module would otherwise have no a11y coverage.
    const user = userEvent.setup();
    const { container } = await openEditor(user);
    await screen.findByLabelText(/account number/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps entity and category locked — the CoA leaf is already minted under them", async () => {
    const user = userEvent.setup();
    await openEditor(user);

    expect(
      (await screen.findByLabelText(/category/i)).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      (await screen.findByLabelText(/corporate entity/i)).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("PATCHes the corrected number and balance instead of creating a second account", async () => {
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    const readThrough = apiClient.tenant;
    const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
      p: string,
      init?: { method?: string; body?: Record<string, unknown> },
    ) => {
      // Reads still have to reach the fixtures — the dossier itself is one.
      if (init?.method !== "PATCH") return readThrough(p, init as never);
      if (init.body) sent.push(init.body);
      return ACCOUNT;
    }) as typeof apiClient.tenant);

    try {
      await openEditor(user);

      const acct = await screen.findByLabelText(/account number/i);
      await user.clear(acct);
      await user.type(acct, "10005210001234");
      const bal = await screen.findByLabelText(/opening balance/i);
      await user.clear(bal);
      await user.type(bal, "15000000");
      await user.click(
        await screen.findByRole("button", { name: /save changes/i }),
      );

      await waitFor(() => expect(sent.length).toBe(1));
      expect(sent[0].account_number).toBe("10005210001234");
      expect(sent[0].opening_balance).toBe(15000000);
      // The label rides along untouched — the service renames the CoA leaf
      // from it, so it must be the current one, not blank.
      expect(sent[0].label).toBe("Afriland First Bank 521-1");
      // Never on a PATCH: the service ignores them and the leaf is minted.
      expect(sent[0].entity_id).toBeUndefined();
      expect(sent[0].category_id).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("clears a field the user emptied rather than leaving the old value behind", async () => {
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    const readThrough = apiClient.tenant;
    const spy = vi.spyOn(apiClient, "tenant").mockImplementation((async (
      p: string,
      init?: { method?: string; body?: Record<string, unknown> },
    ) => {
      if (init?.method !== "PATCH") return readThrough(p, init as never);
      if (init.body) sent.push(init.body);
      return ACCOUNT;
    }) as typeof apiClient.tenant);

    try {
      await openEditor(user);
      await user.clear(await screen.findByLabelText(/^branch$/i));
      await user.click(
        await screen.findByRole("button", { name: /save changes/i }),
      );

      await waitFor(() => expect(sent.length).toBe(1));
      // `undefined` would drop the key and keep "Douala — Bonanjo" forever.
      expect(sent[0].branch).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
