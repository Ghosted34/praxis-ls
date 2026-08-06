"use strict";
/** Party compliance engine (spec §4.1, Hard Rules 3 & 9; PR3 §3) — pure rules. */
const {
  evaluate, stateFor, stateForParty, docTypeApplies, isOnboarding, requiredTypes,
} = require("../../src/modules/master/compliance/compliance.rules");

const TODAY = "2026-08-06";
// A REQUIRED, applies-to-all taxpayer card; and a NON-required optional contract.
const taxType = { document_type_id: "dt-tax", name: "Taxpayer Card", applies_to: "BOTH", is_active: true, is_required: true, default_severity: "ESCALATED" };
const contractType = { document_type_id: "dt-contract", name: "Contract", applies_to: "BOTH", is_active: true, is_required: false, default_severity: "WARN" };
const otherType = { document_type_id: "dt-other", name: "Other", applies_to: "BOTH", is_active: true, is_required: false, default_severity: "INFO" };
// A required doc scoped to one category / country / tier.
const customsType = { document_type_id: "dt-customs", name: "Customs Authorisation", applies_to: "SUPPLIER", is_active: true, is_required: true, default_severity: "ESCALATED", applies_to_categories: ["CUSTOMS_BROKER"] };
const frOnlyType = { document_type_id: "dt-fr", name: "FR Cert", applies_to: "BOTH", is_active: true, is_required: true, default_severity: "ESCALATED", applies_to_countries: ["FR"] };
const enhancedType = { document_type_id: "dt-edd", name: "EDD Pack", applies_to: "BOTH", is_active: true, is_required: true, default_severity: "ESCALATED", kyc_tier: "ENHANCED" };

const withLegal = { legal_name: "Acme SA" };
const draft = { legal_name: "Acme SA", registration_status: "DRAFT" };

const hasFlag = (r, rule_key, severity) =>
  r.flags.some((f) => f.rule_key === rule_key && (severity === undefined || f.severity === severity));
const countFlag = (r, rule_key) => r.flags.filter((f) => f.rule_key === rule_key).length;

describe("stateFor / stateForParty", () => {
  it("rolls up to the worst severity; INFO alone is OK", () => {
    expect(stateFor([{ severity: "INFO" }])).toBe("OK");
    expect(stateFor([{ severity: "WARN" }, { severity: "ESCALATED" }])).toBe("ESCALATED");
    expect(stateFor([{ severity: "SOFT_BLOCK_RECOMMENDATION" }, { severity: "WARN" }])).toBe("SOFT_BLOCK_RECOMMENDATION");
  });
  it("reports ONBOARDING when a still-onboarding party's flags are all onboarding gaps", () => {
    const flags = [{ severity: "ESCALATED", onboarding: true }, { severity: "WARN", onboarding: true }];
    expect(stateForParty(flags, draft)).toBe("ONBOARDING");
    // A live party with the same gaps is not onboarding — it escalates.
    expect(stateForParty(flags, { registration_status: "ACTIVE" })).toBe("ESCALATED");
    // One real (non-onboarding) flag drops the neutral treatment.
    expect(stateForParty([...flags, { severity: "ESCALATED" }], draft)).toBe("ESCALATED");
  });
});

describe("isOnboarding", () => {
  it("is true for DRAFT/PENDING_REVIEW and supplier PROSPECT/PENDING_KYC, false once live", () => {
    expect(isOnboarding({ registration_status: "DRAFT" })).toBe(true);
    expect(isOnboarding({ registration_status: "PENDING_REVIEW" })).toBe(true);
    expect(isOnboarding({ avl_status: "PROSPECT" })).toBe(true);
    expect(isOnboarding({ avl_status: "PENDING_KYC" })).toBe(true);
    expect(isOnboarding({ registration_status: "ACTIVE" })).toBe(false);
    expect(isOnboarding({})).toBe(false);
  });
});

describe("docTypeApplies", () => {
  it("matches role, category, country and tier; empty scope applies to all", () => {
    expect(docTypeApplies(taxType, { appliesTo: "CLIENT" })).toBe(true);
    expect(docTypeApplies(customsType, { appliesTo: "SUPPLIER", category: "CUSTOMS_BROKER" })).toBe(true);
    expect(docTypeApplies(customsType, { appliesTo: "SUPPLIER", category: "WATER_SUPPLIER" })).toBe(false);
    expect(docTypeApplies(customsType, { appliesTo: "CLIENT", category: "CUSTOMS_BROKER" })).toBe(false); // wrong role
    expect(docTypeApplies(frOnlyType, { appliesTo: "CLIENT", country: "FR" })).toBe(true);
    expect(docTypeApplies(frOnlyType, { appliesTo: "CLIENT", country: "CM" })).toBe(false);
    expect(docTypeApplies(enhancedType, { appliesTo: "CLIENT", tier: "ENHANCED" })).toBe(true);
    expect(docTypeApplies(enhancedType, { appliesTo: "CLIENT", tier: "BASIC" })).toBe(false);
    expect(docTypeApplies({ ...taxType, is_active: false }, { appliesTo: "CLIENT" })).toBe(false);
  });
});

describe("evaluate — required-ness & applicability (§3.1/§3.2)", () => {
  it("escalates a missing REQUIRED document but stays silent on a non-required one", () => {
    const r = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [], docTypes: [taxType, contractType], today: TODAY });
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true); // taxType (required)
    expect(countFlag(r, "party.doc_missing")).toBe(1);               // contract is NOT flagged
    expect(r.compliance_state).toBe("ESCALATED");                    // no reg status ⇒ not onboarding
    expect(r.can_verify).toBe(false);
  });

  it("OTHER / non-required types never raise a missing flag (kills 'Missing Other')", () => {
    const r = evaluate({ appliesTo: "SUPPLIER", party: withLegal, documents: [], docTypes: [otherType, contractType], today: TODAY });
    expect(hasFlag(r, "party.doc_missing")).toBe(false);
    expect(r.compliance_state).toBe("OK");
  });

  it("does not flag a required doc that does not apply to the party's category (water supplier vs customs auth)", () => {
    const water = evaluate({ appliesTo: "SUPPLIER", party: withLegal, documents: [], docTypes: [customsType], category: "WATER_SUPPLIER", today: TODAY });
    expect(hasFlag(water, "party.doc_missing")).toBe(false);
    const broker = evaluate({ appliesTo: "SUPPLIER", party: withLegal, documents: [], docTypes: [customsType], category: "CUSTOMS_BROKER", today: TODAY });
    expect(hasFlag(broker, "party.doc_missing", "ESCALATED")).toBe(true);
  });

  it("honours country and tier scoping", () => {
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, docTypes: [frOnlyType], country: "CM", today: TODAY }), "party.doc_missing")).toBe(false);
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, docTypes: [frOnlyType], country: "FR", today: TODAY }), "party.doc_missing")).toBe(true);
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, docTypes: [enhancedType], tier: "BASIC", today: TODAY }), "party.doc_missing")).toBe(false);
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, docTypes: [enhancedType], tier: "ENHANCED", today: TODAY }), "party.doc_missing")).toBe(true);
  });
});

describe("evaluate — onboarding vs real risk (§3.3)", () => {
  it("a fresh DRAFT missing its required docs reads ONBOARDING, not ESCALATED", () => {
    const r = evaluate({ appliesTo: "SUPPLIER", party: draft, documents: [], docTypes: [taxType], today: TODAY });
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true);
    expect(r.flags.every((f) => f.onboarding)).toBe(true);
    expect(r.compliance_state).toBe("ONBOARDING");
    expect(r.can_verify).toBe(false);
  });

  it("a pending scan on a DRAFT is an onboarding gap (WARN → ONBOARDING)", () => {
    const paper = { document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-08-20" };
    const r = evaluate({ appliesTo: "CLIENT", party: draft, documents: [paper], docTypes: [taxType], today: TODAY });
    expect(hasFlag(r, "party.scan_pending", "WARN")).toBe(true);
    expect(r.compliance_state).toBe("ONBOARDING");
  });

  it("real issues escalate even on a DRAFT: unverified bank, expiry, overdue scan, sanctions", () => {
    const bank = evaluate({ appliesTo: "SUPPLIER", party: draft, documents: [], docTypes: [], banks: [{ is_verified: false }], today: TODAY });
    expect(bank.compliance_state).toBe("ESCALATED");

    const expired = evaluate({ appliesTo: "CLIENT", party: draft, documents: [{ document_type_id: "dt-tax", vault_id: "v1", verification_status: "VERIFIED", expires_on: "2026-07-01" }], docTypes: [taxType], today: TODAY });
    expect(hasFlag(expired, "party.doc_expired", "ESCALATED")).toBe(true);
    expect(expired.compliance_state).toBe("ESCALATED");

    const overdue = evaluate({ appliesTo: "CLIENT", party: draft, documents: [{ document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-07-01" }], docTypes: [taxType], today: TODAY });
    expect(hasFlag(overdue, "party.scan_overdue", "ESCALATED")).toBe(true);
    expect(overdue.compliance_state).toBe("ESCALATED");

    const sanctioned = evaluate({ appliesTo: "CLIENT", party: { ...draft, screen_status: "HIT" }, documents: [], docTypes: [], today: TODAY });
    expect(hasFlag(sanctioned, "party.sanctions_hit", "ESCALATED")).toBe(true);
    expect(sanctioned.compliance_state).toBe("ESCALATED");
    expect(sanctioned.can_verify).toBe(false);
  });
});

describe("evaluate — the scan gate & verification (Hard Rule 9)", () => {
  it("lets a party be verified only once every required doc is scanned AND verified", () => {
    const paper = { document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-08-20" };
    const r1 = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [paper], docTypes: [taxType], today: TODAY });
    expect(r1.can_verify).toBe(false);

    const scanned = { document_type_id: "dt-tax", vault_id: "v1", scan_status: "VERIFIED", verification_status: "VERIFIED" };
    const r2 = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [scanned], docTypes: [taxType], today: TODAY });
    expect(r2.can_verify).toBe(true);
    expect(r2.compliance_state).toBe("OK");
  });

  it("requiredTypes only counts required + applicable types", () => {
    expect(requiredTypes([taxType, contractType, otherType], { appliesTo: "CLIENT" }).map((d) => d.document_type_id)).toEqual(["dt-tax"]);
    expect(requiredTypes([customsType], { appliesTo: "SUPPLIER", category: "WATER_SUPPLIER" })).toHaveLength(0);
  });
});

describe("evaluate — severity ladder invariants (Hard Rule 3)", () => {
  it("ESCALATES an unverified bank account (BEC control)", () => {
    const r = evaluate({ appliesTo: "SUPPLIER", party: withLegal, documents: [], docTypes: [], banks: [{ is_verified: false, bank_name: "Afriland" }], today: TODAY });
    expect(hasFlag(r, "party.bank_unverified", "ESCALATED")).toBe(true);
  });

  it("recommends a soft block on credit over-limit but never HARD_BLOCKs", () => {
    const r = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [], docTypes: [], creditStatus: { within: false }, today: TODAY });
    expect(hasFlag(r, "party.credit_over_limit", "SOFT_BLOCK_RECOMMENDATION")).toBe(true);
  });

  it("NEVER emits HARD_BLOCK from a rule, however bad the party is", () => {
    const awful = {
      appliesTo: "SUPPLIER",
      party: { screen_status: "HIT", risk_tier: "HIGH" },
      documents: [{ document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-01-01" }],
      docTypes: [taxType],
      banks: [{ is_verified: false }],
      creditStatus: { within: false },
      today: TODAY,
    };
    const r = evaluate(awful);
    expect(r.flags.every((f) => f.severity !== "HARD_BLOCK")).toBe(true);
    expect(r.compliance_state).not.toBe("HARD_BLOCK");
  });
});
