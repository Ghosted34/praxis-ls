/**
 * DMARC parsing, RBL verdicts, PTR, regression detection.
 */
"use strict";

const { parseDmarc } = require("../../src/modules/mail/deliverability/dmarc");
const { checkRbl, reverseIpv4 } = require("../../src/modules/mail/deliverability/rbl");
const { checkPtr } = require("../../src/modules/mail/deliverability/ptr");
const { toRow, regression } = require("../../src/modules/mail/deliverability/evaluate");

describe("parseDmarc", () => {
  test("p=none is monitoring only — said in those words", () => {
    const p = parseDmarc("v=DMARC1; p=none; rua=mailto:postmaster@x.cm");
    expect(p.policy).toBe("none");
    expect(p.ok).toBe(true);
    expect(p.reading).toMatch(/monitoring only/i);
    expect(p.reading).toMatch(/spoof/i);
    expect(p.rua).toBe("mailto:postmaster@x.cm");
  });

  test("p=reject is the policy that actually stops spoofing", () => {
    const p = parseDmarc("v=DMARC1; p=reject; adkim=s; aspf=s");
    expect(p.policy).toBe("reject");
    expect(p.dkim_alignment).toBe("strict");
    expect(p.reading).toMatch(/stops spoofing/);
  });

  test("a missing v= is not silently treated as a policy", () => {
    const p = parseDmarc("p=none");
    expect(p.reading).toMatch(/not a DMARC record/);
  });
});

describe("RBL", () => {
  test("reverseIpv4 is the DNSBL query form", () => {
    expect(reverseIpv4("1.2.3.4")).toBe("4.3.2.1");
    expect(reverseIpv4("not-an-ip")).toBeNull();
  });

  test("a clean IP (ENOTFOUND on every list) is PASS", async () => {
    const r = await checkRbl("1.2.3.4", {
      hosts: ["zen.spamhaus.org"],
      resolve: async () => { const e = new Error("no"); e.code = "ENOTFOUND"; throw e; },
    });
    expect(r.verdict).toBe("PASS");
    expect(r.ok).toBe(true);
  });

  test("a listed IP is FAIL and names the list", async () => {
    const r = await checkRbl("1.2.3.4", {
      hosts: ["zen.spamhaus.org", "bl.spamcop.net"],
      resolve: async (name) => (name.includes("spamhaus") ? ["127.0.0.2"] : Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" }))),
    });
    expect(r.verdict).toBe("FAIL");
    expect(r.hint).toContain("zen.spamhaus.org");
  });
});

describe("PTR", () => {
  test("names are PASS", async () => {
    const r = await checkPtr("1.2.3.4", { reverse: async () => ["mail.smartlogistics.cm"] });
    expect(r.verdict).toBe("PASS");
    expect(r.names).toEqual(["mail.smartlogistics.cm"]);
  });

  test("NXDOMAIN is FAIL with a sentence about matching HELO", async () => {
    const r = await checkPtr("1.2.3.4", {
      reverse: async () => { const e = new Error("x"); e.code = "NXDOMAIN"; throw e; },
    });
    expect(r.verdict).toBe("FAIL");
    expect(r.hint).toMatch(/HELO/);
  });
});

describe("regression", () => {
  test("PASS → FAIL is a regression", () => {
    expect(regression({ verdict: "PASS" }, { verdict: "FAIL" })).toBe(true);
    expect(regression({ verdict: "FAIL" }, { verdict: "FAIL" })).toBe(false);
    expect(regression({ verdict: "PASS" }, { verdict: "PASS" })).toBe(false);
    expect(regression(null, { verdict: "FAIL" })).toBe(false);
  });

  test("toRow maps ok:true/false/null onto PASS/FAIL/UNKNOWN", () => {
    expect(toRow("x.cm", "SPF", { ok: true, record: "v=spf1 mx ~all" }).verdict).toBe("PASS");
    expect(toRow("x.cm", "DKIM", { ok: false, hint: "missing" }).verdict).toBe("FAIL");
    expect(toRow("x.cm", "MX", { ok: null }).verdict).toBe("UNKNOWN");
  });
});
