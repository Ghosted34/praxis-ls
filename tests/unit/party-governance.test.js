"use strict";
/**
 * PR3-C governance — the PURE halves of the merge, scorecard, maker-checker and
 * transactional-gate logic (the DB-backed reattachment/archive proof lives in
 * tests/integration/party-merge.test.js, which self-skips without DATABASE_URL).
 */
const scorecard = require("../../src/modules/master/supplier_scorecard.service");
const merge = require("../../src/modules/master/party_merge/party_merge.service");
const changeRequest = require("../../src/modules/master/_shared/change-request.service");
const compliance = require("../../src/modules/master/compliance/compliance.service");

describe("supplier scorecard — computeScores (pure)", () => {
  it("falls back to neutral-positive scores with no operational data", () => {
    const s = scorecard.computeScores({});
    expect(s.score_on_time).toBe(80);
    expect(s.score_claims).toBe(90);
    expect(s.score_disputes).toBe(90);
    expect(s.score_responsiveness).toBe(75);
    expect(s.score_safety).toBe(85);
    expect(s.score_compliance).toBe(100);
    expect(s.score_overall).toBeGreaterThan(80);
    expect(s.score_overall).toBeLessThanOrEqual(100);
  });

  it("derives on-time from the PO fulfilment ratio", () => {
    const s = scorecard.computeScores({
      poClosed: 8,
      poCancelled: 2,
      poTotal: 10,
    });
    expect(s.score_on_time).toBe(80); // 8 / (8+2)
    expect(s.score_disputes).toBe(80); // 100 - 2/10*100
  });

  it("lowers compliance for open + escalated flags and clamps at 0", () => {
    expect(
      scorecard.computeScores({ openFlags: 1, escalatedFlags: 1 })
        .score_compliance,
    ).toBe(85); // 100 - 8 - 7
    expect(
      scorecard.computeScores({ openFlags: 20, escalatedFlags: 20 })
        .score_compliance,
    ).toBe(0);
  });

  it("raises responsiveness with interaction activity, capped at 100", () => {
    expect(scorecard.computeScores({ activity: 5 }).score_responsiveness).toBe(
      75,
    ); // 60 + 5*3
    expect(
      scorecard.computeScores({ activity: 100 }).score_responsiveness,
    ).toBe(100);
  });
});

describe("governed merge — loserNames (pure)", () => {
  it("returns the distinct trading names, legal first, case-insensitively deduped", () => {
    expect(
      merge.loserNames({
        legal_name: "Bolloré Transport SA",
        name: "Bolloré",
        trading_name: "bolloré",
      }),
    ).toEqual(["Bolloré Transport SA", "Bolloré"]);
  });
  it("handles a party with only a display name", () => {
    expect(merge.loserNames({ name: "Acme" })).toEqual(["Acme"]);
  });
  it("ignores blanks", () => {
    expect(
      merge.loserNames({ legal_name: "", name: "  ", trading_name: null }),
    ).toEqual([]);
  });
});

describe("maker-checker — pickSensitiveMaster + assertNotRequester (pure)", () => {
  it("splits legal name / credit limit / status out of the patch and leaves the rest", () => {
    const patch = {
      legal_name: "New SA",
      credit_limit: 5_000_000,
      industry: "Freight",
      website: "x.cm",
    };
    const { sensitive, changeType } = changeRequest.pickSensitiveMaster(patch);
    expect(sensitive).toEqual({
      legal_name: "New SA",
      credit_limit: 5_000_000,
    });
    expect(changeType).toBe("LEGAL_NAME");
    expect(patch).toEqual({ industry: "Freight", website: "x.cm" }); // mutated: sensitive removed
  });
  it("classifies a credit-limit-only change as CREDIT_LIMIT and a status-only change as STATUS", () => {
    expect(
      changeRequest.pickSensitiveMaster({ credit_limit: 1 }).changeType,
    ).toBe("CREDIT_LIMIT");
    expect(
      changeRequest.pickSensitiveMaster({ registration_status: "ACTIVE" })
        .changeType,
    ).toBe("STATUS");
    expect(
      changeRequest.pickSensitiveMaster({ industry: "x" }).changeType,
    ).toBeNull();
  });
  it("forbids the requester from approving their own change", () => {
    expect(() =>
      changeRequest.assertNotRequester(
        { requested_by: "u1" },
        { user_id: "u1" },
      ),
    ).toThrow(/must be approved by someone else/);
  });
  it("allows a different approver, and a null maker", () => {
    expect(() =>
      changeRequest.assertNotRequester(
        { requested_by: "u1" },
        { user_id: "u2" },
      ),
    ).not.toThrow();
    expect(() =>
      changeRequest.assertNotRequester(
        { requested_by: null },
        { user_id: "u2" },
      ),
    ).not.toThrow();
  });
});

describe("transactional gate — gateDecision (pure)", () => {
  it("HARD_BLOCK stops with a reason and no override", () => {
    const g = compliance.gateDecision({
      party: { hard_blocked_at: "2026-01-01", hard_block_reason: "sanctions" },
      compliance_state: "HARD_BLOCK",
    });
    expect(g.allowed).toBe(false);
    expect(g.requiresOverride).toBe(false);
    expect(g.reason).toMatch(/sanctions/);
  });
  it("SOFT_BLOCK_RECOMMENDATION and ESCALATED allow WITH a logged override", () => {
    for (const state of ["SOFT_BLOCK_RECOMMENDATION", "ESCALATED"]) {
      const g = compliance.gateDecision({ party: {}, compliance_state: state });
      expect(g.allowed).toBe(true);
      expect(g.requiresOverride).toBe(true);
    }
  });
  it("WARN / INFO / ONBOARDING / OK allow with no override", () => {
    for (const state of ["WARN", "INFO", "ONBOARDING", "OK"]) {
      const g = compliance.gateDecision({ party: {}, compliance_state: state });
      expect(g.allowed).toBe(true);
      expect(g.requiresOverride).toBe(false);
    }
  });
  it("blocking flags exclude onboarding gaps", () => {
    const g = compliance.gateDecision({
      party: {},
      compliance_state: "ESCALATED",
      flags: [
        {
          rule_key: "party.doc_missing",
          severity: "ESCALATED",
          onboarding: true,
        },
        {
          rule_key: "party.bank_unverified",
          severity: "ESCALATED",
          message: "Unverified bank",
        },
      ],
    });
    expect(g.blockingFlags).toHaveLength(1);
    expect(g.blockingFlags[0].rule_key).toBe("party.bank_unverified");
  });
});
