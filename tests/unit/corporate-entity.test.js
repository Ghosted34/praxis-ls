"use strict";
/**
 * Corporate entity (MOD-01) — lifecycle, group structure and cap-table rules.
 *
 * The cap-table tests exist because reconciliation is ADVISORY: it must report
 * every disagreement it can find and throw for none of them, since a
 * partly-recorded cap table is the normal state during onboarding and a hard
 * failure would block the very data collection the module is for.
 */
const rules = require("../../src/modules/master/corporate_entity/corporate_entity.rules");
const {
  redactPerson, isoDate, maskEntityBank, maskPaymentBlock,
} = require("../../src/modules/master/entity-360.service");

describe("entity lifecycle transitions", () => {
  it("allows the ordinary onboarding path", () => {
    expect(() => rules.assertTransition("DRAFT", "PENDING_REVIEW")).not.toThrow();
    expect(() => rules.assertTransition("PENDING_REVIEW", "ACTIVE")).not.toThrow();
    expect(() => rules.assertTransition("ACTIVE", "SUSPENDED")).not.toThrow();
    expect(() => rules.assertTransition("SUSPENDED", "ACTIVE")).not.toThrow();
  });

  it("treats ARCHIVED as terminal", () => {
    expect(() => rules.assertTransition("ARCHIVED", "ACTIVE")).toThrow(/final/i);
  });

  it("refuses to archive straight from ACTIVE", () => {
    // Deactivate first — that hop is the auditable decision.
    expect(() => rules.assertTransition("ACTIVE", "ARCHIVED")).toThrow(/cannot go from ACTIVE to ARCHIVED/i);
    expect(() => rules.assertTransition("DEACTIVATED", "ARCHIVED")).not.toThrow();
  });

  it("keeps the legacy active=false route total from every pre-live state", () => {
    // POST /entities/:id/active maps false -> DEACTIVATED from wherever it finds
    // the entity; a 409 there would be a regression on a published route.
    for (const from of ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED"]) {
      expect(() => rules.assertTransition(from, "DEACTIVATED")).not.toThrow();
    }
  });

  it("treats a null current status as ACTIVE (rows predating the ladder)", () => {
    expect(() => rules.assertTransition(null, "SUSPENDED")).not.toThrow();
  });

  it("is a no-op when the status does not change", () => {
    expect(() => rules.assertTransition("ARCHIVED", "ARCHIVED")).not.toThrow();
  });

  it("rejects a status that is not on the ladder", () => {
    expect(() => rules.assertTransition("ACTIVE", "DELETED")).toThrow(/not a valid entity status/i);
  });

  it("requires a reason for the three states that need an audit trail", () => {
    for (const s of ["SUSPENDED", "DEACTIVATED", "ARCHIVED"]) {
      expect(() => rules.assertReasonFor(s, "")).toThrow(/reason/i);
      expect(() => rules.assertReasonFor(s, "   ")).toThrow(/reason/i);
      expect(() => rules.assertReasonFor(s, "Dormant")).not.toThrow();
    }
    expect(() => rules.assertReasonFor("ACTIVE", "")).not.toThrow();
  });
});

describe("group structure cycle guard", () => {
  const map = (pairs) => new Map(pairs.map(([a, b]) => [a, b]));

  it("accepts a plain parent", () => {
    expect(() => rules.assertNoCycle("b", "a", map([["a", null], ["b", null]]))).not.toThrow();
  });

  it("accepts clearing the parent", () => {
    expect(() => rules.assertNoCycle("b", null, map([["a", null]]))).not.toThrow();
  });

  it("rejects self-parenting", () => {
    expect(() => rules.assertNoCycle("a", "a", map([["a", null]]))).toThrow(/own parent/i);
  });

  it("rejects a two-hop loop", () => {
    // a's parent is b; making b's parent a closes the loop.
    expect(() => rules.assertNoCycle("b", "a", map([["a", "b"], ["b", null]]))).toThrow(/loop/i);
  });

  it("rejects a deep loop the database CHECK cannot see", () => {
    // a -> b -> c ; re-parenting c under a would close a three-hop cycle.
    expect(() => rules.assertNoCycle("c", "a", map([["a", "b"], ["b", "c"], ["c", null]]))).toThrow(/loop/i);
  });

  it("terminates on data that is already cyclic", () => {
    // A row that predates the guard, or arrived by direct SQL. The walk must
    // stop rather than hang the request.
    expect(() => rules.assertNoCycle("x", "a", map([["a", "b"], ["b", "a"]]))).toThrow(/loop/i);
  });
});

describe("cap table reconciliation", () => {
  const holder = (over) => ({
    person_id: "p" + Math.random(), role: "SHAREHOLDER", full_name: "Holder", ...over,
  });

  it("reports a balanced table with no warnings", () => {
    const r = rules.reconcileCapTable(
      [holder({ full_name: "A", share_count: 60, ownership_percent: 60 }),
       holder({ full_name: "B", share_count: 40, ownership_percent: 40 })],
      {},
    );
    expect(r.total_percent).toBe(100);
    expect(r.total_shares).toBe(100);
    expect(r.holder_count).toBe(2);
    expect(r.balanced).toBe(true);
  });

  it("flags over-allocation as a warning, not an error", () => {
    const r = rules.reconcileCapTable(
      [holder({ ownership_percent: 60 }), holder({ ownership_percent: 60 })],
      {},
    );
    expect(r.balanced).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("OVER_ALLOCATED");
  });

  it("treats under-allocation as INFO — an incomplete table is normal", () => {
    const r = rules.reconcileCapTable([holder({ ownership_percent: 60 })], {});
    const f = r.findings.find((x) => x.code === "UNDER_ALLOCATED");
    expect(f.severity).toBe("INFO");
    // INFO does not unbalance the table: onboarding must not look broken.
    expect(r.balanced).toBe(true);
  });

  it("catches share counts disagreeing with stated percentages", () => {
    const r = rules.reconcileCapTable(
      [holder({ full_name: "A", share_count: 90, ownership_percent: 50 }),
       holder({ full_name: "B", share_count: 10, ownership_percent: 50 })],
      {},
    );
    expect(r.findings.filter((f) => f.code === "PERCENT_MISMATCH")).toHaveLength(2);
  });

  it("tolerates rounding on thirds", () => {
    const r = rules.reconcileCapTable(
      [holder({ share_count: 1, ownership_percent: 33.33 }),
       holder({ share_count: 1, ownership_percent: 33.33 }),
       holder({ share_count: 1, ownership_percent: 33.34 })],
      {},
    );
    expect(r.findings.some((f) => f.code === "PERCENT_MISMATCH")).toBe(false);
  });

  it("reconciles issued shares against stated share capital", () => {
    const r = rules.reconcileCapTable(
      [holder({ share_count: 100, share_nominal_value: 1000, ownership_percent: 100 })],
      { share_capital: 250000 },
    );
    expect(r.issued_capital).toBe(100000);
    expect(r.findings.map((f) => f.code)).toContain("CAPITAL_MISMATCH");
  });

  it("counts only holdings current at the reconciliation date", () => {
    const people = [
      holder({ full_name: "Past", ownership_percent: 100, effective_from: "2020-01-01", effective_to: "2024-12-31" }),
      holder({ full_name: "Now", ownership_percent: 100, effective_from: "2025-01-01" }),
    ];
    // Without the date filter both would count and the table would read 200%.
    expect(rules.reconcileCapTable(people, {}, "2026-01-01").total_percent).toBe(100);
    // ...and the historical position is reconstructable.
    const then = rules.reconcileCapTable(people, {}, "2023-06-01");
    expect(then.total_percent).toBe(100);
    expect(then.findings.some((f) => f.code === "OVER_ALLOCATED")).toBe(false);
  });

  it("ignores non-shareholder roles", () => {
    const r = rules.reconcileCapTable(
      [holder({ ownership_percent: 100 }), { role: "DIRECTOR", full_name: "D", ownership_percent: 50 }],
      {},
    );
    expect(r.holder_count).toBe(1);
    expect(r.total_percent).toBe(100);
  });

  it("renders for an entity with no people at all", () => {
    const r = rules.reconcileCapTable([], {});
    expect(r).toMatchObject({ holder_count: 0, total_percent: 0, total_shares: 0, balanced: true });
    expect(r.findings).toEqual([]);
  });

  it("never throws, whatever it is handed", () => {
    expect(() => rules.reconcileCapTable(null, null)).not.toThrow();
    expect(() => rules.reconcileCapTable([holder({ ownership_percent: "not a number" })], {})).not.toThrow();
  });
});

describe("readiness checklist", () => {
  const complete = {
    entity: { legal_name: "Smart Logistics France SAS", legal_form: "SAS", incorporation_date: "2020-03-01", share_capital: 50000, email: "contact@example.com" },
    children: {
      registrations: [{ kind: "VAT", number: "FR123" }],
      addresses: [{ type: "REGISTERED", line1: "1 rue de la Paix" }],
      people: [{ role: "DIRECTOR", full_name: "A" }],
    },
  };

  it("passes a fully-populated entity", () => {
    const r = rules.readiness(complete.entity, complete.children);
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("lists every gap on a brand-new entity", () => {
    const r = rules.readiness({}, {});
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.field)).toEqual(
      expect.arrayContaining(["legal_name", "legal_form", "incorporation_date", "share_capital", "contact", "registrations", "address", "people"]),
    );
  });

  it("accepts a phone in place of an email", () => {
    const r = rules.readiness({ ...complete.entity, email: null, phone: "+237690000000" }, complete.children);
    expect(r.missing.some((m) => m.field === "contact")).toBe(false);
  });

  it("wants a REGISTERED address specifically, not just any address", () => {
    const r = rules.readiness(complete.entity, { ...complete.children, addresses: [{ type: "WAREHOUSE", line1: "Kribi" }] });
    expect(r.missing.map((m) => m.field)).toContain("address");
  });

  it("accepts a legal representative in place of a director", () => {
    const r = rules.readiness(complete.entity, { ...complete.children, people: [{ role: "LEGAL_REPRESENTATIVE", full_name: "B" }] });
    expect(r.missing.some((m) => m.field === "people")).toBe(false);
  });

  it("survives null arguments", () => {
    // Destructuring an explicit null in the signature would throw rather than
    // fall back to a default, and both arguments come from lookups.
    expect(() => rules.readiness(null, null)).not.toThrow();
    expect(rules.readiness(null, null).ready).toBe(false);
  });

  it("does not accept a shareholder alone as governance", () => {
    const r = rules.readiness(complete.entity, { ...complete.children, people: [{ role: "SHAREHOLDER", full_name: "C" }] });
    expect(r.missing.map((m) => m.field)).toContain("people");
  });
});

describe("governance redaction", () => {
  const person = {
    person_id: "p1", role: "SHAREHOLDER", full_name: "Jane Holder", title: "Director",
    date_of_birth: "1980-05-05", id_type: "PASSPORT", id_number: "AB1234567",
    email: "jane@example.com", phone: "+237690000000",
    share_count: 500, share_nominal_value: 100, ownership_percent: 50, voting_percent: 50,
    signature_limit_amount: 1000000, notes: "Founder",
  };

  it("strips every personal and financial field", () => {
    const r = redactPerson(person);
    for (const f of ["date_of_birth", "id_type", "id_number", "email", "phone", "share_count",
      "share_nominal_value", "ownership_percent", "voting_percent", "signature_limit_amount", "notes"]) {
      expect(r).not.toHaveProperty(f);
    }
  });

  it("keeps name, role and title — those are on the public trade register", () => {
    const r = redactPerson(person);
    expect(r.full_name).toBe("Jane Holder");
    expect(r.role).toBe("SHAREHOLDER");
    expect(r.title).toBe("Director");
  });

  it("marks itself so the client can explain the gap rather than show blanks", () => {
    expect(redactPerson(person).redacted).toBe(true);
  });

  it("does not mutate the row it was given", () => {
    const copy = { ...person };
    redactPerson(person);
    expect(person).toEqual(copy);
  });
});

describe("bank-detail masking (acceptance gate 14)", () => {
  // `corporate_entity` is read with SELECT *, so `bank_block` rides along on the
  // dossier — which is gated MOD-01 `view`, held by Sales and Ops. The account
  // number is finance data and must be masked in the SERIALIZER, exactly as the
  // party masters mask theirs.
  const entity = {
    entity_id: "e1", legal_name: "Smart Logistics Ltd",
    bank_block: { bank_name: "Afriland First Bank", account_number: "10005000123456789012", iban: "CM21…9012", swift: "CCEICMCX" },
  };

  it("masks the account number, IBAN and SWIFT for a caller without finance visibility", () => {
    const m = maskEntityBank(entity, false);
    expect(m.bank_block.account_number).toBe("••••9012");
    expect(m.bank_block.swift).toBe("••••CMCX");
    expect(m.bank_block.masked).toBe(true);
  });

  it("leaves the bank name readable — it is not the secret", () => {
    expect(maskEntityBank(entity, false).bank_block.bank_name).toBe("Afriland First Bank");
  });

  it("returns the block intact for a caller with Treasury read", () => {
    expect(maskEntityBank(entity, true).bank_block.account_number).toBe("10005000123456789012");
  });

  it("does not mutate the row it was given", () => {
    const copy = JSON.parse(JSON.stringify(entity));
    maskEntityBank(entity, false);
    expect(entity).toEqual(copy);
  });

  it("copes with an entity that has no bank block at all", () => {
    expect(() => maskEntityBank({ entity_id: "e2" }, false)).not.toThrow();
    expect(() => maskEntityBank(null, false)).not.toThrow();
  });

  it("masks the rendered payment block too — the same secret, a second route", () => {
    const preview = {
      payment_block: { source: "treasury", accounts: [{ label: "Main", bank_name: "Afriland", account_number: "1000500012345", iban: "CM21X", swift_bic: "CCEICMCX" }] },
    };
    const m = maskPaymentBlock(preview, false);
    expect(m.payment_block.accounts[0].account_number).toBe("••••2345");
    expect(m.payment_block.accounts[0].masked).toBe(true);
    expect(maskPaymentBlock(preview, true).payment_block.accounts[0].account_number).toBe("1000500012345");
  });

  it("copes with a payment block that has no accounts", () => {
    expect(() => maskPaymentBlock({ payment_block: { source: "none" } }, false)).not.toThrow();
    expect(() => maskPaymentBlock(null, false)).not.toThrow();
  });
});

describe("date normalisation for expiry warnings", () => {
  // node-postgres returns a JS Date for `date` columns. `String(date).slice(0,10)`
  // is "Tue Sep 0", which sorts ABOVE every real ISO date because "T" > "2" — so a
  // naive expiry filter matches nothing and a certificate lapses in silence.
  it("normalises a pg Date to YYYY-MM-DD", () => {
    expect(isoDate(new Date("2026-09-05T00:00:00Z"))).toBe("2026-09-05");
  });

  it("passes an ISO string through", () => {
    expect(isoDate("2026-09-05")).toBe("2026-09-05");
    expect(isoDate("2026-09-05T12:30:00Z")).toBe("2026-09-05");
  });

  it("returns null for blanks and unparseable values", () => {
    for (const v of [null, undefined, "", "not a date", new Date("nonsense")]) {
      expect(isoDate(v)).toBeNull();
    }
  });

  it("produces values that compare correctly against an ISO horizon", () => {
    const soon = isoDate(new Date("2026-09-05T00:00:00Z"));
    expect(soon <= "2026-11-04").toBe(true);   // inside a 90-day horizon
    expect(soon < "2026-08-06").toBe(false);   // not yet expired
    // The bug this guards: the raw form fails both comparisons.
    expect(String(new Date("2026-09-05T00:00:00Z")).slice(0, 10) <= "2026-11-04").toBe(false);
  });
});

describe("fiscal year guard", () => {
  it("accepts 1-12 and absence", () => {
    for (const m of [1, 6, 12, null, undefined]) expect(() => rules.assertFiscalMonth(m)).not.toThrow();
  });
  it("rejects out-of-range and non-integers", () => {
    for (const m of [0, 13, -1, 1.5, "March"]) expect(() => rules.assertFiscalMonth(m)).toThrow(/1-12/);
  });
});
