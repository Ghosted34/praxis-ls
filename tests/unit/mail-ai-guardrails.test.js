"use strict";
const { check } = require("../../src/modules/mail/assist/assist.guardrails");

describe("pre-send guardrails", () => {
  test("see attached with no file warns", () => {
    const r = check({ text: "Please see attached.", to: ["a@b.cm"], subject: "Hi", attachments: [] });
    expect(r.warnings.map((w) => w.code)).toContain("MISSING_ATTACHMENT");
    expect(r.blocks).toEqual([]);
  });

  test("an invoice to a suspicious domain is a hard block", () => {
    const r = check(
      { text: "Please find the invoice.", subject: "Invoice INV-1", to: ["ap@evil.cm"], attachments: [{ filename: "invoice.pdf" }] },
      { authVerdict: "LIKELY_IMPERSONATION" },
    );
    expect(r.blocks.map((b) => b.code)).toContain("FINANCIAL_TO_SUSPICIOUS");
  });

  test("verified financial send is not blocked", () => {
    const r = check(
      { text: "Invoice attached.", subject: "Invoice", to: ["ok@client.cm"], attachments: [{ filename: "invoice.pdf" }] },
      { authVerdict: "VERIFIED" },
    );
    expect(r.blocks).toEqual([]);
  });
});
