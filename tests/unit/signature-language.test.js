/**
 * The five-step outbound language order. One helper, used by signatures,
 * templates and (later) AI translation. A second copy of this rule is how a
 * French client starts receiving English invoices.
 */
"use strict";

const { resolveLanguage, asLang } = require("../../src/modules/mail/signature/language");

describe("resolveLanguage order", () => {
  test("1. explicit composer choice wins over everything", () => {
    expect(resolveLanguage({
      explicit: "fr",
      partyLanguage: "en",
      repliedMessageLanguage: "en",
      senderUiLanguage: "en",
      tenantDefault: "en",
    })).toBe("fr");
  });

  test("2. party preferred_language when nothing was chosen", () => {
    expect(resolveLanguage({
      partyLanguage: "fr",
      repliedMessageLanguage: "en",
      senderUiLanguage: "en",
      tenantDefault: "en",
    })).toBe("fr");
  });

  test("3. language of the message being replied to", () => {
    expect(resolveLanguage({
      repliedMessageLanguage: "fr",
      senderUiLanguage: "en",
      tenantDefault: "en",
    })).toBe("fr");
  });

  test("4. the sender's own UI language", () => {
    expect(resolveLanguage({
      senderUiLanguage: "fr",
      tenantDefault: "en",
    })).toBe("fr");
  });

  test("5. tenant default, then en", () => {
    expect(resolveLanguage({ tenantDefault: "fr" })).toBe("fr");
    expect(resolveLanguage({})).toBe("en");
    expect(resolveLanguage({ tenantDefault: "de" })).toBe("en");
  });

  test("an unsupported or empty value is skipped, not used", () => {
    expect(asLang("de")).toBeNull();
    expect(asLang("")).toBeNull();
    expect(asLang(null)).toBeNull();
    expect(asLang("FR")).toBe("fr");
    expect(resolveLanguage({ explicit: "DE", partyLanguage: "fr" })).toBe("fr");
  });
});
