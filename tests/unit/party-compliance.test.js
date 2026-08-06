"use strict";
/** Party compliance engine (spec §4.1, Hard Rules 3 & 9) — pure rules. */
const { evaluate, stateFor } = require("../../src/modules/master/compliance/compliance.rules");

const TODAY = "2026-08-06";
const taxType = { document_type_id: "dt-tax", name: "Taxpayer Card", applies_to: "BOTH", is_active: true, default_severity: "ESCALATED" };
const contractType = { document_type_id: "dt-contract", name: "Contract", applies_to: "BOTH", is_active: true, default_severity: "WARN" };
const withLegal = { legal_name: "Acme SA" };

const hasFlag = (r, rule_key, severity) =>
  r.flags.some((f) => f.rule_key === rule_key && (severity === undefined || f.severity === severity));

describe("stateFor", () => {
  it("rolls up to the worst severity; INFO alone is OK", () => {
    expect(stateFor([{ severity: "INFO" }])).toBe("OK");
    expect(stateFor([{ severity: "WARN" }, { severity: "ESCALATED" }])).toBe("ESCALATED");
    expect(stateFor([{ severity: "SOFT_BLOCK_RECOMMENDATION" }, { severity: "WARN" }])).toBe("SOFT_BLOCK_RECOMMENDATION");
  });
});

describe("evaluate", () => {
  it("ESCALATES a missing mandatory document and WARNs a missing optional one", () => {
    const r = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [], docTypes: [taxType, contractType], today: TODAY });
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true);
    expect(hasFlag(r, "party.doc_missing", "WARN")).toBe(true);
    expect(r.compliance_state).toBe("ESCALATED");
    expect(r.can_verify).toBe(false);
  });

  it("lets a party be verified only once every mandatory doc is scanned AND verified", () => {
    const paper = { document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-08-20" };
    const r1 = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [paper], docTypes: [taxType], today: TODAY });
    expect(r1.can_verify).toBe(false); // paper-only, no scan yet
    expect(hasFlag(r1, "party.scan_pending", "WARN")).toBe(true);

    const scanned = { document_type_id: "dt-tax", vault_id: "v1", scan_status: "VERIFIED", verification_status: "VERIFIED" };
    const r2 = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [scanned], docTypes: [taxType], today: TODAY });
    expect(r2.can_verify).toBe(true);
    expect(r2.compliance_state).toBe("OK");
  });

  it("escalates a paper-only document once its scan SLA has passed (Hard Rule 9)", () => {
    const overdue = { document_type_id: "dt-tax", vault_id: null, scan_due_on: "2026-07-01" };
    const r = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [overdue], docTypes: [taxType], today: TODAY });
    expect(hasFlag(r, "party.scan_overdue", "ESCALATED")).toBe(true);
    expect(r.compliance_state).toBe("ESCALATED");
  });

  it("ESCALATES an expired document and WARNs one expiring within 30 days", () => {
    const expired = { document_type_id: "dt-tax", vault_id: "v1", verification_status: "VERIFIED", expires_on: "2026-07-01" };
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [expired], docTypes: [taxType], today: TODAY }), "party.doc_expired", "ESCALATED")).toBe(true);

    const soon = { document_type_id: "dt-tax", vault_id: "v1", verification_status: "VERIFIED", expires_on: "2026-08-20" };
    expect(hasFlag(evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [soon], docTypes: [taxType], today: TODAY }), "party.doc_expiring", "WARN")).toBe(true);
  });

  it("ESCALATES an unverified bank account (BEC control)", () => {
    const r = evaluate({ appliesTo: "SUPPLIER", party: withLegal, documents: [], docTypes: [], banks: [{ is_verified: false, bank_name: "Afriland" }], today: TODAY });
    expect(hasFlag(r, "party.bank_unverified", "ESCALATED")).toBe(true);
  });

  it("recommends a soft block on credit over-limit but never HARD_BLOCKs", () => {
    const r = evaluate({ appliesTo: "CLIENT", party: withLegal, documents: [], docTypes: [], creditStatus: { within: false }, today: TODAY });
    expect(hasFlag(r, "party.credit_over_limit", "SOFT_BLOCK_RECOMMENDATION")).toBe(true);
  });

  it("a screening hit blocks verification and escalates", () => {
    const r = evaluate({ appliesTo: "CLIENT", party: { legal_name: "X", screen_status: "HIT" }, documents: [], docTypes: [], today: TODAY });
    expect(hasFlag(r, "party.sanctions_hit", "ESCALATED")).toBe(true);
    expect(r.can_verify).toBe(false);
  });

  it("NEVER emits HARD_BLOCK from a rule, however bad the party is (Hard Rule 3)", () => {
    const awful = {
      appliesTo: "SUPPLIER",
      party: { screen_status: "HIT", risk_tier: "HIGH" }, // no legal_name either
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
