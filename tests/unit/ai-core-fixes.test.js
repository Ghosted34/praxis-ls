"use strict";
/**
 * Audit remediation PR 1 — the AI core-quality fixes:
 *   B1 max_tokens + B4 stream_options (llm.service body),
 *   D5 Ask/Draft/Analyse/Act become real (modeDirective),
 *   A2 the OHADA boost no longer fires on the English word "is".
 */

const { modeDirective } = require("../../src/services/ai/orchestrator.service");
const { boostDomainHits } = require("../../src/services/ai/retrieval.service");

describe("modeDirective — the four modes now change the answer (audit D5)", () => {
  test("each mode yields its own distinct posture", () => {
    expect(modeDirective("draft")).toMatch(/DRAFT/);
    expect(modeDirective("analyse")).toMatch(/ANALYSE/);
    expect(modeDirective("act")).toMatch(/ACT/);
    expect(modeDirective("ask")).toMatch(/ASK/);
    // and they are not all the same string
    const all = ["draft", "analyse", "act", "ask"].map(modeDirective);
    expect(new Set(all).size).toBe(4);
  });

  test("Act still only PROPOSES — it never grants execution without confirm", () => {
    expect(modeDirective("act")).toMatch(/confirm/i);
    expect(modeDirective("act")).toMatch(/never execute/i);
  });

  test("absent or unknown mode adds nothing (unmoded turns are unchanged)", () => {
    expect(modeDirective(undefined)).toBe("");
    expect(modeDirective(null)).toBe("");
    expect(modeDirective("bogus")).toBe("");
  });
});

describe("boostDomainHits — OHADA boost fires on accounting, not on 'is' (audit A2)", () => {
  const hits = () => [
    { ref: "codebase/foo", title: "Foo", sim: 0.8 },
    { ref: "OHADA_KB/vat", title: "OHADA VAT rules", sim: 0.7 },
  ];

  test("a plain question containing the word 'is' does NOT boost OHADA docs", () => {
    const out = boostDomainHits(hits(), "what is the status of my dossier?");
    // no re-rank: the closer codebase hit stays first and the OHADA sim is untouched
    expect(out[0].ref).toBe("codebase/foo");
    expect(out.find((h) => h.ref === "OHADA_KB/vat").sim).toBeCloseTo(0.7);
  });

  test("a genuine accounting question DOES lift the OHADA doc above a closer codebase hit", () => {
    const out = boostDomainHits(hits(), "how do I record VAT on this journal entry");
    expect(out[0].ref).toBe("OHADA_KB/vat"); // 0.70 + 0.15 = 0.85 > 0.80
  });
});
