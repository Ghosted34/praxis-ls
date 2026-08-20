"use strict";
const { fence } = require("../../src/modules/mail/assist/assist.factfence");

describe("fact fence", () => {
  const facts = ["Dossier SLAS-2026-0042 — customs cleared 18 Aug", "Invoice INV-2026-0311 — 1 250 000 XAF outstanding"];

  test("a draft using only fact tokens is ok", () => {
    const r = fence("Regarding SLAS-2026-0042, INV-2026-0311 is 1 250 000 outstanding.", facts);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  test("a fabricated reference is caught and never considered ok", () => {
    const r = fence("Please pay INV-2099-0001 of 9 999 999 XAF.", facts);
    expect(r.ok).toBe(false);
    expect(r.violations.join(" ")).toMatch(/INV-2099-0001/);
  });
});
