"use strict";
/** Party compliance engine (spec §4.1, Hard Rules 3 & 9; PR3 §3; 14030) — pure rules. */
const {
  evaluate,
  stateFor,
  stateForParty,
  docTypeApplies,
  isOnboarding,
  requiredTypes,
  activationTypes,
  advisorySeverity,
} = require("../../src/modules/master/compliance/compliance.rules");

const TODAY = "2026-08-06";
// 14030 split ONE flag into TWO answers, and the fixtures below keep them
// distinct on purpose — a fixture that sets both cannot catch the regression
// this ticket exists to fix (a Bank RIB gating activation):
//
//   required_for_activation → the ACTIVATION set: gates `canVerify`, and its
//                             absence is an `onboarding` gap (the 360 checklist).
//   is_required alone       → advisory: reported, WARN at most, gates nothing.
// A REQUIRED-TO-ACTIVATE, applies-to-all taxpayer card; and a NON-required
// optional contract.
const taxType = {
  document_type_id: "dt-tax",
  name: "Taxpayer Card",
  applies_to: "BOTH",
  is_active: true,
  is_required: true,
  required_for_activation: true,
  default_severity: "ESCALATED",
};
const contractType = {
  document_type_id: "dt-contract",
  name: "Contract",
  applies_to: "BOTH",
  is_active: true,
  is_required: false,
  default_severity: "WARN",
};
const otherType = {
  document_type_id: "dt-other",
  name: "Other",
  applies_to: "BOTH",
  is_active: true,
  is_required: false,
  default_severity: "INFO",
};
// 14030: wanted on file, seeded ESCALATED, and NOT an activation requirement —
// exactly the shape 0512 gave BANK_RIB. Its absence must never reach the
// activation checklist and must never be louder than WARN.
const advisoryType = {
  document_type_id: "dt-rib",
  name: "Bank RIB",
  applies_to: "BOTH",
  is_active: true,
  is_required: true,
  required_for_activation: false,
  default_severity: "ESCALATED",
};
// A required-to-activate doc scoped to one category / country / tier.
const customsType = {
  document_type_id: "dt-customs",
  name: "Customs Authorisation",
  applies_to: "SUPPLIER",
  is_active: true,
  is_required: true,
  required_for_activation: true,
  default_severity: "ESCALATED",
  applies_to_categories: ["CUSTOMS_BROKER"],
};
const frOnlyType = {
  document_type_id: "dt-fr",
  name: "FR Cert",
  applies_to: "BOTH",
  is_active: true,
  is_required: true,
  required_for_activation: true,
  default_severity: "ESCALATED",
  applies_to_countries: ["FR"],
};
const enhancedType = {
  document_type_id: "dt-edd",
  name: "EDD Pack",
  applies_to: "BOTH",
  is_active: true,
  is_required: true,
  required_for_activation: true,
  default_severity: "ESCALATED",
  kyc_tier: "ENHANCED",
};
// The ACF (Attestation de conformité fiscale, 14030): required to activate for
// everyone EXCEPT a party provably operating outside Cameroon.
const acfType = {
  document_type_id: "dt-acf",
  name: "Attestation de conformité fiscale",
  applies_to: "CLIENT",
  is_active: true,
  is_required: true,
  required_for_activation: true,
  exempt_outside_country: "CM",
  default_severity: "ESCALATED",
};

const withLegal = { legal_name: "Acme SA" };
const draft = { legal_name: "Acme SA", registration_status: "DRAFT" };

const hasFlag = (r, rule_key, severity) =>
  r.flags.some(
    (f) =>
      f.rule_key === rule_key &&
      (severity === undefined || f.severity === severity),
  );
const countFlag = (r, rule_key) =>
  r.flags.filter((f) => f.rule_key === rule_key).length;

describe("stateFor / stateForParty", () => {
  it("rolls up to the worst severity; INFO alone is OK", () => {
    expect(stateFor([{ severity: "INFO" }])).toBe("OK");
    expect(stateFor([{ severity: "WARN" }, { severity: "ESCALATED" }])).toBe(
      "ESCALATED",
    );
    expect(
      stateFor([
        { severity: "SOFT_BLOCK_RECOMMENDATION" },
        { severity: "WARN" },
      ]),
    ).toBe("SOFT_BLOCK_RECOMMENDATION");
  });
  it("reports ONBOARDING when a still-onboarding party's flags are all onboarding gaps", () => {
    const flags = [
      { severity: "ESCALATED", onboarding: true },
      { severity: "WARN", onboarding: true },
    ];
    expect(stateForParty(flags, draft)).toBe("ONBOARDING");
    // A live party with the same gaps is not onboarding — it escalates.
    expect(stateForParty(flags, { registration_status: "ACTIVE" })).toBe(
      "ESCALATED",
    );
    // One real (non-onboarding) flag drops the neutral treatment.
    expect(stateForParty([...flags, { severity: "ESCALATED" }], draft)).toBe(
      "ESCALATED",
    );
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
    expect(
      docTypeApplies(customsType, {
        appliesTo: "SUPPLIER",
        category: "CUSTOMS_BROKER",
      }),
    ).toBe(true);
    expect(
      docTypeApplies(customsType, {
        appliesTo: "SUPPLIER",
        category: "WATER_SUPPLIER",
      }),
    ).toBe(false);
    expect(
      docTypeApplies(customsType, {
        appliesTo: "CLIENT",
        category: "CUSTOMS_BROKER",
      }),
    ).toBe(false); // wrong role
    expect(
      docTypeApplies(frOnlyType, { appliesTo: "CLIENT", country: "FR" }),
    ).toBe(true);
    expect(
      docTypeApplies(frOnlyType, { appliesTo: "CLIENT", country: "CM" }),
    ).toBe(false);
    expect(
      docTypeApplies(enhancedType, { appliesTo: "CLIENT", tier: "ENHANCED" }),
    ).toBe(true);
    expect(
      docTypeApplies(enhancedType, { appliesTo: "CLIENT", tier: "BASIC" }),
    ).toBe(false);
    expect(
      docTypeApplies({ ...taxType, is_active: false }, { appliesTo: "CLIENT" }),
    ).toBe(false);
  });
});

describe("evaluate — the activation set vs advisory documents (14030)", () => {
  it("escalates a missing REQUIRED-TO-ACTIVATE document and keeps its own severity", () => {
    const r = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [],
      docTypes: [taxType, contractType],
      today: TODAY,
    });
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true); // taxType
    expect(countFlag(r, "party.doc_missing")).toBe(1); // contract is NOT flagged
    expect(r.compliance_state).toBe("ESCALATED"); // no reg status ⇒ not onboarding
    expect(r.can_verify).toBe(false);
    // An activation gap IS the checklist item — that is what puts it under
    // "Required to activate" on the 360.
    expect(r.flags.find((f) => f.rule_key === "party.doc_missing").onboarding).toBe(true);
  });

  it("a merely is_required document raises an ADVISORY flag: WARN-capped, never onboarding, never gating", () => {
    const r = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [],
      docTypes: [advisoryType], // 0512's Bank RIB shape: is_required, not activation
      today: TODAY,
    });
    // Reported — the tenant still wants it on file …
    expect(hasFlag(r, "party.doc_missing", "WARN")).toBe(true);
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(false); // … but capped at WARN
    const f = r.flags.find((x) => x.rule_key === "party.doc_missing");
    expect(f.advisory).toBe(true);
    // … and it is NOT a checklist item, so it never appears under "Required to
    // activate" and never becomes an onboarding gap.
    expect(f.onboarding).toBeUndefined();
    expect(r.flags.some((x) => x.onboarding)).toBe(false);
    // The gate is the activation set, which is EMPTY here ⇒ the party may be
    // verified with no Bank RIB at all. This is the regression the ticket fixes.
    expect(r.can_verify).toBe(true);
  });

  it("an advisory gap on a DRAFT reads the neutral ONBOARDING, and WARN once the party is live", () => {
    const base = {
      appliesTo: "CLIENT",
      documents: [],
      docTypes: [advisoryType],
      today: TODAY,
    };
    // Still onboarding ⇒ checklist work, not a compliance failure: the same
    // neutral rollup a missing activation document gets. It is NOT an onboarding
    // flag though (see the test above), so it cannot reach the activation list.
    const early = evaluate({ ...base, party: draft });
    expect(early.compliance_state).toBe("ONBOARDING");
    expect(early.flags.some((f) => f.onboarding)).toBe(false);
    // Live ⇒ the advisory surfaces at its capped severity, and nothing more.
    const live = evaluate({ ...base, party: { ...withLegal, registration_status: "ACTIVE" } });
    expect(live.compliance_state).toBe("WARN");
    expect(live.flags).toHaveLength(1);
  });

  it("advisorySeverity caps an advisory at WARN and leaves real severities alone", () => {
    expect(advisorySeverity("ESCALATED")).toBe("WARN");
    expect(advisorySeverity("SOFT_BLOCK_RECOMMENDATION")).toBe("WARN");
    expect(advisorySeverity("INFO")).toBe("INFO");
    expect(advisorySeverity(undefined)).toBe("WARN");
  });

  it("activationTypes is the set canVerify enforces — required_for_activation, not is_required", () => {
    const ctx = { appliesTo: "CLIENT" };
    expect(activationTypes([taxType, advisoryType, contractType], ctx).map((d) => d.document_type_id)).toEqual(["dt-tax"]);
    expect(requiredTypes([taxType, advisoryType], ctx).map((d) => d.document_type_id)).toEqual(["dt-tax", "dt-rib"]);
  });

  it("an empty activation set can_verify even with every advisory type missing", () => {
    const r = evaluate({
      appliesTo: "SUPPLIER",
      party: withLegal,
      documents: [],
      docTypes: [advisoryType],
      today: TODAY,
    });
    expect(r.can_verify).toBe(true);
  });

  it("turns a missing ACTIVATION FIELD into an onboarding checklist item (14030)", () => {
    const r = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [],
      docTypes: [],
      missingActivationFields: [{ field_key: "niu", label: "NIU" }],
      today: TODAY,
    });
    const f = r.flags.find((x) => x.rule_key === "party.field_missing");
    expect(f).toBeTruthy();
    expect(f.severity).toBe("WARN");
    expect(f.onboarding).toBe(true);
    expect(f.message).toBe("Missing NIU");
    // It is a field, not a document: it must not disturb the document gate.
    expect(r.can_verify).toBe(true);
  });

  it("does not flag a required doc that does not apply to the party's category (water supplier vs customs auth)", () => {
    const water = evaluate({
      appliesTo: "SUPPLIER",
      party: withLegal,
      documents: [],
      docTypes: [customsType],
      category: "WATER_SUPPLIER",
      today: TODAY,
    });
    expect(hasFlag(water, "party.doc_missing")).toBe(false);
    const broker = evaluate({
      appliesTo: "SUPPLIER",
      party: withLegal,
      documents: [],
      docTypes: [customsType],
      category: "CUSTOMS_BROKER",
      today: TODAY,
    });
    expect(hasFlag(broker, "party.doc_missing", "ESCALATED")).toBe(true);
  });
});

describe("evaluate — the ACF exemption (14030)", () => {
  it("applies to a party in Cameroon, and to one whose country is unknown", () => {
    for (const country of ["CM", undefined]) {
      const r = evaluate({
        appliesTo: "CLIENT",
        party: country ? { ...withLegal, country_code: country } : withLegal,
        documents: [],
        docTypes: [acfType],
        today: TODAY,
      });
      expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true);
      expect(r.can_verify).toBe(false);
    }
  });

  it("is EXEMPT outside Cameroon — no flag, and no gate", () => {
    const r = evaluate({
      appliesTo: "CLIENT",
      party: { ...withLegal, country_code: "FR" },
      documents: [],
      docTypes: [acfType],
      today: TODAY,
    });
    expect(hasFlag(r, "party.doc_missing")).toBe(false);
    expect(r.can_verify).toBe(true);
    expect(
      docTypeApplies(acfType, { appliesTo: "CLIENT", country: "FR" }),
    ).toBe(false);
    // Tax residency answers too when country_code is blank.
    expect(
      docTypeApplies(acfType, { appliesTo: "CLIENT", country: "CM" }),
    ).toBe(true);
  });

  it("never exempts on an empty country, and ignores the exemption when the type is not flagged", () => {
    expect(docTypeApplies(acfType, { appliesTo: "CLIENT", country: "" })).toBe(true);
    expect(docTypeApplies(acfType, { appliesTo: "CLIENT" })).toBe(true);
    const plain = { ...acfType, exempt_outside_country: null };
    expect(docTypeApplies(plain, { appliesTo: "CLIENT", country: "FR" })).toBe(true);
  });

  it("OTHER / non-required types never raise a missing flag (kills 'Missing Other')", () => {
    const r = evaluate({
      appliesTo: "SUPPLIER",
      party: withLegal,
      documents: [],
      docTypes: [otherType, contractType],
      today: TODAY,
    });
    expect(hasFlag(r, "party.doc_missing")).toBe(false);
    expect(r.compliance_state).toBe("OK");
  });
});

describe("evaluate — applicability scoping (§3.2)", () => {
  it("honours country and tier scoping", () => {
    expect(
      hasFlag(
        evaluate({
          appliesTo: "CLIENT",
          party: withLegal,
          docTypes: [frOnlyType],
          country: "CM",
          today: TODAY,
        }),
        "party.doc_missing",
      ),
    ).toBe(false);
    expect(
      hasFlag(
        evaluate({
          appliesTo: "CLIENT",
          party: withLegal,
          docTypes: [frOnlyType],
          country: "FR",
          today: TODAY,
        }),
        "party.doc_missing",
      ),
    ).toBe(true);
    expect(
      hasFlag(
        evaluate({
          appliesTo: "CLIENT",
          party: withLegal,
          docTypes: [enhancedType],
          tier: "BASIC",
          today: TODAY,
        }),
        "party.doc_missing",
      ),
    ).toBe(false);
    expect(
      hasFlag(
        evaluate({
          appliesTo: "CLIENT",
          party: withLegal,
          docTypes: [enhancedType],
          tier: "ENHANCED",
          today: TODAY,
        }),
        "party.doc_missing",
      ),
    ).toBe(true);
  });
});

describe("evaluate — onboarding vs real risk (§3.3)", () => {
  it("a fresh DRAFT missing its required docs reads ONBOARDING, not ESCALATED", () => {
    const r = evaluate({
      appliesTo: "SUPPLIER",
      party: draft,
      documents: [],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(hasFlag(r, "party.doc_missing", "ESCALATED")).toBe(true);
    expect(r.flags.every((f) => f.onboarding)).toBe(true);
    expect(r.compliance_state).toBe("ONBOARDING");
    expect(r.can_verify).toBe(false);
  });

  it("a pending scan on a DRAFT is an onboarding gap (WARN → ONBOARDING)", () => {
    const paper = {
      document_type_id: "dt-tax",
      vault_id: null,
      scan_due_on: "2026-08-20",
    };
    const r = evaluate({
      appliesTo: "CLIENT",
      party: draft,
      documents: [paper],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(hasFlag(r, "party.scan_pending", "WARN")).toBe(true);
    expect(r.compliance_state).toBe("ONBOARDING");
  });

  it("real issues escalate even on a DRAFT: unverified bank, expiry, overdue scan, sanctions", () => {
    const bank = evaluate({
      appliesTo: "SUPPLIER",
      party: draft,
      documents: [],
      docTypes: [],
      banks: [{ is_verified: false }],
      today: TODAY,
    });
    expect(bank.compliance_state).toBe("ESCALATED");

    const expired = evaluate({
      appliesTo: "CLIENT",
      party: draft,
      documents: [
        {
          document_type_id: "dt-tax",
          vault_id: "v1",
          verification_status: "VERIFIED",
          expires_on: "2026-07-01",
        },
      ],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(hasFlag(expired, "party.doc_expired", "ESCALATED")).toBe(true);
    expect(expired.compliance_state).toBe("ESCALATED");

    const overdue = evaluate({
      appliesTo: "CLIENT",
      party: draft,
      documents: [
        {
          document_type_id: "dt-tax",
          vault_id: null,
          scan_due_on: "2026-07-01",
        },
      ],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(hasFlag(overdue, "party.scan_overdue", "ESCALATED")).toBe(true);
    expect(overdue.compliance_state).toBe("ESCALATED");

    const sanctioned = evaluate({
      appliesTo: "CLIENT",
      party: { ...draft, screen_status: "HIT" },
      documents: [],
      docTypes: [],
      today: TODAY,
    });
    expect(hasFlag(sanctioned, "party.sanctions_hit", "ESCALATED")).toBe(true);
    expect(sanctioned.compliance_state).toBe("ESCALATED");
    expect(sanctioned.can_verify).toBe(false);
  });
});

describe("evaluate — the scan gate & verification (Hard Rule 9)", () => {
  it("lets a party be verified only once every required doc is scanned AND verified", () => {
    const paper = {
      document_type_id: "dt-tax",
      vault_id: null,
      scan_due_on: "2026-08-20",
    };
    const r1 = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [paper],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(r1.can_verify).toBe(false);

    const scanned = {
      document_type_id: "dt-tax",
      vault_id: "v1",
      scan_status: "VERIFIED",
      verification_status: "VERIFIED",
    };
    const r2 = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [scanned],
      docTypes: [taxType],
      today: TODAY,
    });
    expect(r2.can_verify).toBe(true);
    expect(r2.compliance_state).toBe("OK");
  });

  it("requiredTypes only counts required + applicable types", () => {
    expect(
      requiredTypes([taxType, contractType, otherType], {
        appliesTo: "CLIENT",
      }).map((d) => d.document_type_id),
    ).toEqual(["dt-tax"]);
    expect(
      requiredTypes([customsType], {
        appliesTo: "SUPPLIER",
        category: "WATER_SUPPLIER",
      }),
    ).toHaveLength(0);
  });
});

describe("evaluate — severity ladder invariants (Hard Rule 3)", () => {
  it("ESCALATES an unverified bank account (BEC control)", () => {
    const r = evaluate({
      appliesTo: "SUPPLIER",
      party: withLegal,
      documents: [],
      docTypes: [],
      banks: [{ is_verified: false, bank_name: "Afriland" }],
      today: TODAY,
    });
    expect(hasFlag(r, "party.bank_unverified", "ESCALATED")).toBe(true);
  });

  it("recommends a soft block on credit over-limit but never HARD_BLOCKs", () => {
    const r = evaluate({
      appliesTo: "CLIENT",
      party: withLegal,
      documents: [],
      docTypes: [],
      creditStatus: { within: false },
      today: TODAY,
    });
    expect(
      hasFlag(r, "party.credit_over_limit", "SOFT_BLOCK_RECOMMENDATION"),
    ).toBe(true);
  });

  it("NEVER emits HARD_BLOCK from a rule, however bad the party is", () => {
    const awful = {
      appliesTo: "SUPPLIER",
      party: { screen_status: "HIT", risk_tier: "HIGH" },
      documents: [
        {
          document_type_id: "dt-tax",
          vault_id: null,
          scan_due_on: "2026-01-01",
        },
      ],
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
