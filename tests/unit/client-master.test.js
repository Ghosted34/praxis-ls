"use strict";
/** Client master rules — KYC completeness + credit availability. */
const { kycComplete, creditStatus } = require("../../src/modules/master/client_master/client_master.rules");

describe("kycComplete", () => {
  it("needs NIU + RCCM + at least one KYC doc", () => {
    expect(kycComplete({ niu: "N", rccm: "R", kyc_docs: [{}] })).toBe(true);
    expect(kycComplete({ niu: "N", rccm: "R", kyc_docs: [] })).toBe(false);
    expect(kycComplete({ niu: "N", kyc_docs: [{}] })).toBe(false);
  });
});

describe("creditStatus", () => {
  it("null limit = unlimited (always within)", () => {
    const s = creditStatus({ credit_limit: null, cached_receivables: 5000000 }, 1000000);
    expect(s.limit).toBeNull();
    expect(s.within).toBe(true);
  });
  it("computes available and within-limit", () => {
    const s = creditStatus({ credit_limit: 10000000, cached_receivables: 6000000 }, 2000000);
    expect(s.available).toBe(4000000);
    expect(s.within).toBe(true);
  });
  it("flags when exposure exceeds the limit", () => {
    const s = creditStatus({ credit_limit: 10000000, cached_receivables: 9000000 }, 2000000);
    expect(s.within).toBe(false);
  });
});
