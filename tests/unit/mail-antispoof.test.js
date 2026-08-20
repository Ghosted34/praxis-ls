"use strict";
const { evaluate, lookalike } = require("../../src/modules/mail/triage/antispoof");

describe("lookalike detection", () => {
  test("smartlogistics-cm.com vs smartlogistics.cm is impersonation despite SPF", () => {
    const r = evaluate(
      { from_address: "billing@smartlogistics-cm.com", auth: { dmarc: "dmarc=pass" }, body_text: "please find the invoice" },
      { verifiedDomains: ["smartlogistics.cm"] },
    );
    expect(r.verdict).toBe("LIKELY_IMPERSONATION");
  });

  test("levenshtein ≤ 2 is caught", () => {
    expect(lookalike("smartlogistlcs.cm", ["smartlogistics.cm"])).toBeTruthy();
  });

  test("a new-bank-details message from an unverified domain is SUSPICIOUS", () => {
    const r = evaluate(
      { from_address: "ap@unknown.cm", body_text: "Please use our new bank details, IBAN CM21..." },
      { verifiedDomains: ["client.cm"] },
    );
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.detail.bank_change).toBe(true);
  });
});
