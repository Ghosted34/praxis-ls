"use strict";
const {
  directionLetter, formatCode, resolveDebours, tierRank, tierIncludes, primaryServiceKey, needsAttention,
} = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");

describe("financial dictionary rules (MOD-05)", () => {
  test("code letter follows the direction", () => {
    expect(directionLetter("REVENUE")).toBe("R");
    expect(directionLetter("EXPENSE")).toBe("E");
    expect(directionLetter("DEBOURS")).toBe("D");
    expect(directionLetter("ASSET")).toBe("A");
    expect(directionLetter("NONSENSE")).toBe("X");
  });

  test("code is '#<L><NNN>' with at least three digits, rolling past 999", () => {
    expect(formatCode("DEBOURS", 263)).toBe("#D263");
    expect(formatCode("REVENUE", 1)).toBe("#R001");
    expect(formatCode("EXPENSE", 42)).toBe("#E042");
    expect(formatCode("ASSET", 1000)).toBe("#A1000"); // auto-rolls to 4 digits
  });

  test("débours always carries the flag; otherwise the toggle wins", () => {
    expect(resolveDebours("DEBOURS", false)).toBe(true); // forced on
    expect(resolveDebours("EXPENSE", true)).toBe(true);
    expect(resolveDebours("EXPENSE", false)).toBe(false);
    expect(resolveDebours("REVENUE", undefined)).toBe(false);
  });

  test("tiers nest: BASIC ⊆ ADVANCED ⊆ FULL", () => {
    expect(tierRank("BASIC")).toBe(1);
    expect(tierRank("ADVANCED")).toBe(2);
    expect(tierRank("FULL")).toBe(3);
    // Pulling ADVANCED shows BASIC + ADVANCED lines, not FULL-only ones.
    expect(tierIncludes("ADVANCED", "BASIC")).toBe(true);
    expect(tierIncludes("ADVANCED", "ADVANCED")).toBe(true);
    expect(tierIncludes("ADVANCED", "FULL")).toBe(false);
    // Pulling FULL shows everything.
    expect(tierIncludes("FULL", "BASIC")).toBe(true);
    expect(tierIncludes("FULL", "FULL")).toBe(true);
    // Pulling BASIC shows only BASIC lines.
    expect(tierIncludes("BASIC", "ADVANCED")).toBe(false);
  });

  test("primaryServiceKey prefers a BASIC tier, then the first, else null", () => {
    expect(primaryServiceKey([])).toBe(null);
    expect(primaryServiceKey(null)).toBe(null);
    expect(primaryServiceKey([{ service_key: "AIR", tier: "ADVANCED" }, { service_key: "SEA", tier: "BASIC" }])).toBe("SEA");
    expect(primaryServiceKey([{ service_key: "AIR", tier: "ADVANCED" }, { service_key: "RAIL", tier: "FULL" }])).toBe("AIR");
  });

  test("compliance gap: always-required receipt with no proof source", () => {
    expect(needsAttention({ receipt_requirement: "ALWAYS_REQUIRED", proof_source: null })).toBe(true);
    expect(needsAttention({ receipt_requirement: "ALWAYS_REQUIRED", proof_source: "PORT_TERMINAL" })).toBe(false);
    expect(needsAttention({ receipt_requirement: "NOT_REQUIRED", proof_source: null })).toBe(false);
  });
});
