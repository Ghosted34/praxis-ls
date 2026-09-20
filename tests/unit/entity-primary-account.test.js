"use strict";

/**
 * PR-10 / A0–A5 — the primary treasury account, and who may read it.
 *
 * The owner's binding product decisions (PR-10 brief):
 *
 *   A0  bank_name / account_number / holder name are VISIBLE on the Entity-360
 *       "Banking & treasury" tab and the letterhead payment block to every
 *       caller with MOD-01 view — NOT restricted to MOD-09 read / CEO. The
 *       relaxation is deliberate and limited to these two surfaces; the
 *       Treasury module's own dossier keeps gate 14.
 *   A1  ONE resolver decides which account is the primary: the entity's
 *       remittance account when it resolves to an active account, else the
 *       single is_primary account, else "unset". A tenant with six accounts
 *       must never produce six payment blocks or six bank rows.
 *   A2  the holder name is holder_name (0520, what Treasury writes), with
 *       beneficiary_name (0516) as a legacy fallback — one source of truth.
 *
 * ── WHY THE VISIBILITY TESTS CALL THE SERIALIZERS WITH financials:false ────
 *
 * Both surfaces are MOD-01 `view` routes. Before PR-10 their serializers
 * additionally masked bank fields unless the caller held MOD-09 read, so the
 * very people who edit the letterhead saw `••••` where their invoice would
 * print a real number. The relaxation is asserted HERE, against the real
 * serializer, so it cannot be mistaken for an oversight and quietly re-tightened:
 * a plain MOD-01-view caller (no MOD-09 grant, not the CEO) must receive the
 * full bank_name / account_number / holder on BOTH surfaces.
 */

const MOCK_GRANTS_BY_MODULE = {};

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: async (_client, { module }) => MOCK_GRANTS_BY_MODULE[module] || [],
  getUserScopeClosure: async () => [],
}));

/*
 * The repo rows a multi-bank tenant actually returns. Six accounts is the
 * audit's own number: the per-(entity, category) primary clearing let every
 * one of them be "primary" at once.
 */
const HOLDER = "Smart Logistics and Services Ltd";
const ACCOUNTS = [
  { treasury_account_id: "ta1", kind: "BANK", label: "Afriland — Main XAF", bank_name: "Afriland First Bank", account_number: "10005000123456", iban: "CM21100030000100200456", swift_bic: "CCEICMCX", currency: "XAF", holder_name: HOLDER, is_active: true, is_primary: true, show_on_documents: true },
  { treasury_account_id: "ta2", kind: "BANK", label: "UBA — EUR", bank_name: "UBA Cameroun", account_number: "20001234567890", iban: "CM21100030000200300456", swift_bic: "UNAFCMCX", currency: "EUR", holder_name: HOLDER, is_active: true, is_primary: false, show_on_documents: true },
  { treasury_account_id: "ta3", kind: "BANK", label: "SGC — Dormant", bank_name: "Société Générale Cameroun", account_number: "30009876543210", currency: "XAF", holder_name: HOLDER, is_active: false, is_primary: false, show_on_documents: false },
  { treasury_account_id: "ta4", kind: "CASH", label: "Petty cash", currency: "XAF", is_active: true, is_primary: false, show_on_documents: false },
  { treasury_account_id: "ta5", kind: "MOMO", label: "MTN MoMo", momo_network: "MTN", momo_number: "650000001", currency: "XAF", is_active: true, is_primary: false, show_on_documents: false },
  { treasury_account_id: "ta6", kind: "BANK", label: "Ecobank — USD", bank_name: "Ecobank Cameroun", account_number: "40005555000111", currency: "USD", holder_name: HOLDER, is_active: true, is_primary: false, show_on_documents: false },
];

const ENTITY = {
  entity_id: "e1",
  code: "SLAS",
  legal_name: HOLDER,
  legal_form: "SARL",
  default_currency: "XAF",
  default_language: "en",
  country_code: "CM",
  niu: null,
  rccm: null,
  address: "123 Rue de la Gare, Douala",
  remittance_account_id: null,
  bank_block: {},
};

/** The client double the dossier/service paths hand to the mocked repo. */
const NO_CLIENT = { query: async () => ({ rows: [] }) };

let mockAccounts = ACCOUNTS;
let mockEntity = ENTITY;

jest.mock("../../src/modules/master/corporate_entity/corporate_entity.repo", () => ({
  WRITABLE: [],
  LETTERHEAD_WRITABLE: [],
  get: async () => mockEntity,
  getByCode: async () => null,
  first: async () => mockEntity,
  list: async () => [mockEntity],
  collections: async () => ({ people: [], contacts: [], addresses: [], registrations: [], establishments: [] }),
  children: async () => [],
  ancestors: async () => [],
  usage: async () => ({ journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 }),
  treasuryAccounts: async () => mockAccounts,
  documentsAndTax: async () => ({ documents: [], tax_registrations: [], letterhead: null }),
  taxObligations: async () => [],
  letterheadLines: async () => [],
}));

const lh = require("../../src/modules/master/entity-letterhead.service");
const dossierService = require("../../src/modules/master/entity-360.service");
const entityService = require("../../src/modules/master/corporate_entity/corporate_entity.service");

/** A caller with MOD-01 view and NOTHING else — the A0 audience. */
const MOD01_VIEW_ONLY = { governance: false, financials: false, capabilities: { view: true, edit: false, approve: false, public_story: false }, tax: true };

beforeEach(() => {
  mockAccounts = ACCOUNTS.map((a) => ({ ...a }));
  mockEntity = { ...ENTITY };
});

/* ── A1 — the resolver ────────────────────────────────────────────────────── */

describe("resolvePrimaryAccount — one rule, both surfaces", () => {
  test("the remittance account wins when it resolves to an active account", () => {
    const r = lh.resolvePrimaryAccount({ ...ENTITY, remittance_account_id: "ta2" }, ACCOUNTS);
    expect(r.state).toBe("account");
    expect(r.account.treasury_account_id).toBe("ta2");
  });

  test("a remittance pointer at an INACTIVE account does not resolve — the flag falls through", () => {
    const r = lh.resolvePrimaryAccount({ ...ENTITY, remittance_account_id: "ta3" }, ACCOUNTS);
    expect(r.state).toBe("account");
    expect(r.account.treasury_account_id).toBe("ta1"); // the single is_primary
  });

  test("a dangling remittance pointer (deleted account) falls through, not 404", () => {
    const r = lh.resolvePrimaryAccount({ ...ENTITY, remittance_account_id: "gone" }, ACCOUNTS);
    expect(r.state).toBe("account");
    expect(r.account.treasury_account_id).toBe("ta1");
  });

  test("no remittance: the single is_primary account is the primary", () => {
    const r = lh.resolvePrimaryAccount(ENTITY, ACCOUNTS);
    expect(r.state).toBe("account");
    expect(r.account.treasury_account_id).toBe("ta1");
  });

  test("no remittance and NO primary at all: unset", () => {
    const none = ACCOUNTS.map((a) => ({ ...a, is_primary: false }));
    expect(lh.resolvePrimaryAccount(ENTITY, none)).toMatchObject({ state: "unset", account: null });
    expect(lh.resolvePrimaryAccount(ENTITY, [])).toMatchObject({ state: "unset", account: null });
  });

  test("multiple flagged primaries are AMBIGUOUS, never a pick — the six-accounts defect", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      treasury_account_id: `ta${n}`, kind: "BANK", label: `Bank ${n}`, is_active: true, is_primary: true,
    }));
    expect(lh.resolvePrimaryAccount(ENTITY, six)).toMatchObject({ state: "ambiguous", account: null });
  });
});

/* ── A1/A4 — the payment block honours the resolver ───────────────────────── */

describe("paymentBlock — the primary account, or nothing", () => {
  test("prints exactly ONE account — the primary — never every flagged account", () => {
    const p = lh.paymentBlock(ENTITY, ACCOUNTS);
    expect(p.source).toBe("treasury");
    expect(p.accounts).toHaveLength(1);
    expect(p.accounts[0].treasury_account_id).toBe("ta1");
    expect(p.accounts[0].bank_name).toBe("Afriland First Bank");
  });

  test("the six-primary tenant prints NOTHING — no six payment blocks", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      treasury_account_id: `ta${n}`, kind: "BANK", label: `Bank ${n}`, bank_name: `Bank ${n}`,
      account_number: String(n).repeat(10), is_active: true, is_primary: true, show_on_documents: true,
    }));
    const p = lh.paymentBlock(ENTITY, six);
    expect(p.accounts).toHaveLength(0);
    expect(p.source).toBe("no_primary"); // explicit, not "none": the designer says WHY
  });

  test("accounts present but no primary: explicit empty state, no fallback to the frozen bank_block", () => {
    const noPrimary = ACCOUNTS.map((a) => ({ ...a, is_primary: false }));
    const e = { ...ENTITY, bank_block: { bank_name: "Legacy", account_number: "999" } };
    const p = lh.paymentBlock(e, noPrimary);
    expect(p.source).toBe("no_primary");
    expect(p.accounts).toHaveLength(0);
    expect(JSON.stringify(p)).not.toContain("Legacy");
  });

  test("an entity with NO treasury accounts at all keeps the frozen bank_block fallback", () => {
    // 0516's compat contract: existing tenants' invoices render unchanged on
    // the day the treasury source of truth ships.
    const e = { ...ENTITY, bank_block: { bank_name: "Afriland First Bank", account_number: "999", swift: "CCEICMCX" } };
    const p = lh.paymentBlock(e, []);
    expect(p.source).toBe("bank_block_legacy");
    expect(p.accounts[0].bank_name).toBe("Afriland First Bank");
  });

  test("A2: the holder is holder_name, with beneficiary_name as the legacy fallback, then the legal name", () => {
    const withHolder = [{ treasury_account_id: "ta1", label: "Main", is_active: true, is_primary: true, holder_name: "Smart Logistics SARL" }];
    expect(lh.paymentBlock(ENTITY, withHolder).accounts[0].holder_name).toBe("Smart Logistics SARL");

    const legacy = [{ treasury_account_id: "ta1", label: "Main", is_active: true, is_primary: true, beneficiary_name: "Old beneficiary" }];
    expect(lh.paymentBlock(ENTITY, legacy).accounts[0].holder_name).toBe("Old beneficiary");

    const bare = [{ treasury_account_id: "ta1", label: "Main", is_active: true, is_primary: true }];
    expect(lh.paymentBlock(ENTITY, bare).accounts[0].holder_name).toBe(HOLDER);
  });

  test("render() reports a switched-on-but-empty payment block for the no_primary state too", () => {
    const noPrimary = ACCOUNTS.map((a) => ({ ...a, is_primary: false }));
    const r = lh.render({ entity: ENTITY, treasuryAccounts: noPrimary });
    expect(r.empty_blocks).toContain("payment_block");
  });
});

/* ── A0 — a plain MOD-01-view caller sees the bank details on BOTH surfaces ── */

describe("A0 — MOD-01 view sees full bank details on the 360 and the letterhead", () => {
  test("GET /entities/:id/360: treasury rows and the payment block carry the real numbers", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", MOD01_VIEW_ONLY);

    // The Banking & treasury tab's rows — unmasked for this caller.
    const ta1 = data.treasury_accounts.find((t) => t.treasury_account_id === "ta1");
    expect(ta1.bank_name).toBe("Afriland First Bank");
    expect(ta1.account_number).toBe("10005000123456");
    expect(ta1.holder_name).toBe(HOLDER);
    expect(ta1.masked).toBeUndefined();

    // The letterhead preview's payment block — same numbers the invoice prints.
    expect(data.letterhead_preview.payment_block.accounts).toHaveLength(1);
    expect(data.letterhead_preview.payment_block.accounts[0]).toMatchObject({
      bank_name: "Afriland First Bank",
      account_number: "10005000123456",
      holder_name: HOLDER,
    });

    // The whole serialized body has no mask dots on an account number.
    expect(JSON.stringify(data)).not.toContain("••••");
  });

  test("GET /entities/:id/360: the tab gets the resolver's answer, not just the rows", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", MOD01_VIEW_ONLY);
    expect(data.treasury_primary).toMatchObject({ state: "account" });
    expect(data.treasury_primary.account.treasury_account_id).toBe("ta1");
  });

  test("GET /entities/:id/360: six accounts still serialize SIX rows but ONE primary", async () => {
    mockAccounts = [1, 2, 3, 4, 5, 6].map((n) => ({
      treasury_account_id: `ta${n}`, kind: "BANK", label: `Bank ${n}`, account_number: String(n).repeat(10),
      is_active: true, is_primary: true, show_on_documents: true,
    }));
    const data = await dossierService.dossier(NO_CLIENT, "e1", MOD01_VIEW_ONLY);
    expect(data.treasury_accounts).toHaveLength(6);
    expect(data.treasury_primary).toMatchObject({ state: "ambiguous", account: null });
    expect(data.letterhead_preview.payment_block.accounts).toHaveLength(0);
  });

  test("GET /entities/:id/360: unset primary is explicit, so the tab can say so", async () => {
    mockAccounts = ACCOUNTS.map((a) => ({ ...a, is_primary: false }));
    const data = await dossierService.dossier(NO_CLIENT, "e1", MOD01_VIEW_ONLY);
    expect(data.treasury_primary).toMatchObject({ state: "unset", account: null });
  });

  test("GET /entities/:id/letterhead: the payment block and account list are unmasked for MOD-01 view", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { financials: false, tax: true });
    const ta1 = out.treasury_accounts.find((t) => t.treasury_account_id === "ta1");
    expect(ta1.account_number).toBe("10005000123456");
    expect(ta1.masked).toBeUndefined();

    const en = out.preview.en;
    expect(en.payment_block.accounts).toHaveLength(1);
    expect(en.payment_block.accounts[0]).toMatchObject({
      bank_name: "Afriland First Bank",
      account_number: "10005000123456",
      holder_name: HOLDER,
    });

    // The composed blocks the studio draws — the payment line prints the real
    // number, not a row of dots.
    const payment = out.blocks.en.footer.find((b) => b.id === "payment");
    expect(payment.lines.map((l) => l.text).join(" ")).toContain("10005000123456");
    expect(JSON.stringify(out)).not.toContain("••••");
  });
});

/* ── A3 — the identifiers are NIU/RCCM (trade register), not VAT ───────────── */

describe("A3 — the letterhead identifiers carry no tax-registration VAT", () => {
  test("a VAT tax registration contributes NO identifier", () => {
    const ids = lh.identifiers(
      { niu: null, rccm: null },
      [{ kind: "NIU", number: "P012345678901X" }, { kind: "RCCM", number: "RCCM/CM/DLA/2021/B/9999" }],
      [{ tax_kind: "VAT", tax_number: "FR40123456789", is_active: true }],
    );
    expect(ids.map((i) => i.kind).sort()).toEqual(["NIU", "RCCM"]);
    expect(JSON.stringify(ids)).not.toContain("FR40123456789");
  });

  test("NIU + RCCM registration rows print exactly those two", () => {
    const ids = lh.identifiers(
      { niu: null, rccm: null },
      [{ kind: "NIU", number: "P012345678901X" }, { kind: "RCCM", number: "RCCM/CM/DLA/2021/B/9999" }],
    );
    expect(ids).toEqual([
      { kind: "NIU", number: "P012345678901X" },
      { kind: "RCCM", number: "RCCM/CM/DLA/2021/B/9999" },
    ]);
  });
});
