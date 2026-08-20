"use strict";

const presets = require("../../src/services/signatures/presets");
const { signaturePolicyFor } = require("../../src/modules/vault/document_vault/document_vault.types");

const CATALOGUE = [
  { preset_code: "STAMP", label_en: "Digital stamp", label_fr: "Cachet numérique", blurb_en: "b", blurb_fr: "b", assurance_level: "AES_OTP", visual_mark: "STAMP", assurance_rank: 2, tier_label: "1", is_active: true, sort_order: 10 },
  { preset_code: "DRAWN", label_en: "Draw", label_fr: "Dessiner", blurb_en: "b", blurb_fr: "b", assurance_level: "AES_OTP", visual_mark: "DRAWN", assurance_rank: 2, tier_label: "2", is_active: true, sort_order: 20 },
  { preset_code: "CERTIFIED", label_en: "Certified", label_fr: "Certifiée", blurb_en: "b", blurb_fr: "b", assurance_level: "QES", visual_mark: "PROVIDER", assurance_rank: 3, tier_label: "3", is_active: true, sort_order: 30 },
  { preset_code: "PRINT_SIGN", label_en: "Print", label_fr: "Imprimer", blurb_en: "b", blurb_fr: "b", assurance_level: "WET", visual_mark: "INK", assurance_rank: 2, tier_label: "4", is_active: true, sort_order: 40 },
];

/** A tenant connection: the preset catalogue, one policy row, and the flags. */
function makeClient({ allowed = ["STAMP", "DRAWN"], preferred = "STAMP", flagsOn = [] } = {}) {
  return {
    query: async (sql, params = []) => {
      if (/FROM signature_preset/.test(sql)) return { rows: CATALOGUE };
      if (/FROM signature_reason/.test(sql)) return { rows: [{ reason_code: "APPROVED_DISPATCH", label_en: "Approved for dispatch", label_fr: "Approuvé" }] };
      if (/FROM feature_state/.test(sql)) return { rows: flagsOn.map((k) => ({ feature_key: k })) };
      if (/FROM setting/.test(sql)) {
        const [, key] = params;
        if (key && key !== "SOMETHING_ELSE") return { rows: [{ value: { allowed, default: preferred } }] };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe("the eligibility funnel — §3.4", () => {
  test("level 2: only the cards the tenant enabled reach the signer", async () => {
    const menu = await presets.resolveMenu(makeClient(), { docType: "FINAL_INVOICE" });
    expect(menu.cards.map((c) => c.preset_code)).toEqual(["STAMP", "DRAWN"]);
    expect(menu.default).toBe("STAMP");
  });

  test("level 1: a doc type's ceiling beats the tenant's setting", async () => {
    // An employment contract may not be wet-signed: it would put a salary on
    // paper travelling through an office. Even a tenant that enables the card
    // does not get it.
    const client = makeClient({ allowed: ["STAMP", "PRINT_SIGN"], flagsOn: ["signatures.wet"] });
    const menu = await presets.resolveMenu(client, { docType: "EMPLOYMENT_CONTRACT" });
    expect(menu.cards.map((c) => c.preset_code)).toEqual(["STAMP"]);
    expect(menu.blocked).toContainEqual({ preset_code: "PRINT_SIGN", reason: "NOT_AVAILABLE_FOR_DOC_TYPE" });
  });

  test("a card whose feature flag is off is BLOCKED WITH A REASON, not hidden", async () => {
    // A counterparty told "you can sign by hand" should see why the option is
    // greyed out, not wonder whether the page is broken.
    const client = makeClient({ allowed: ["STAMP", "PRINT_SIGN"] }); // signatures.wet off
    const menu = await presets.resolveMenu(client, { docType: "DELIVERY_NOTE" });
    expect(menu.cards.map((c) => c.preset_code)).toEqual(["STAMP"]);
    expect(menu.blocked).toContainEqual({ preset_code: "PRINT_SIGN", reason: "FEATURE_OFF", feature: "signatures.wet" });
  });

  test("level 3: requireCertified collapses the menu to CERTIFIED alone", async () => {
    const client = makeClient({ allowed: ["STAMP", "DRAWN", "CERTIFIED"], flagsOn: ["signatures.qes"] });
    const menu = await presets.resolveMenu(client, { docType: "FINAL_INVOICE", requireCertified: true });
    expect(menu.cards.map((c) => c.preset_code)).toEqual(["CERTIFIED"]);
    expect(menu.blocked.map((b) => b.reason)).toContain("CERTIFIED_REQUIRED");
  });

  test("level 3: allowPaper=false drops PRINT_SIGN and leaves the rest", async () => {
    const client = makeClient({ allowed: ["STAMP", "DRAWN", "PRINT_SIGN"], flagsOn: ["signatures.wet"] });
    const menu = await presets.resolveMenu(client, { docType: "DELIVERY_NOTE", allowPaper: false });
    expect(menu.cards.map((c) => c.preset_code)).toEqual(["STAMP", "DRAWN"]);
    expect(menu.blocked).toContainEqual({ preset_code: "PRINT_SIGN", reason: "PAPER_NOT_ALLOWED" });
  });

  test("requireCertified with no certified card fails AT DISPATCH, not at signing", async () => {
    // The sender must learn this now — not the counterparty, on opening a link
    // that offers them nothing they can do.
    const client = makeClient({ allowed: ["STAMP"] });
    await expect(presets.resolveMenu(client, { docType: "FINAL_INVOICE", requireCertified: true }))
      .rejects.toMatchObject({ code: "CERTIFIED_NOT_AVAILABLE" });
  });

  test("an empty menu is a configuration error with a route to fix it", async () => {
    const client = makeClient({ allowed: [] });
    await expect(presets.resolveMenu(client, { docType: "FINAL_INVOICE" }))
      .rejects.toMatchObject({ code: "EMPTY_SIGNATURE_MENU", details: { settings_route: "/settings/signatures" } });
  });

  test("an unsignable doc type is refused outright", async () => {
    await expect(presets.resolveMenu(makeClient(), { docType: "PAYSLIP" }))
      .rejects.toMatchObject({ code: "DOC_TYPE_NOT_SIGNABLE" });
  });

  test("the default falls back to the first card when the configured one is gone", async () => {
    const client = makeClient({ allowed: ["DRAWN"], preferred: "STAMP" });
    const menu = await presets.resolveMenu(client, { docType: "FINAL_INVOICE" });
    expect(menu.default).toBe("DRAWN");
  });

  test("labels follow the requested language", async () => {
    const en = await presets.resolveMenu(makeClient(), { docType: "FINAL_INVOICE", language: "en" });
    const fr = await presets.resolveMenu(makeClient(), { docType: "FINAL_INVOICE", language: "fr" });
    expect(en.cards[0].label).toBe("Digital stamp");
    expect(fr.cards[0].label).toBe("Cachet numérique");
  });
});

describe("assertAllowed — the server-side gate", () => {
  test("passes a card that is in the menu", async () => {
    const menu = await presets.resolveMenu(makeClient(), { docType: "FINAL_INVOICE" });
    expect(presets.assertAllowed(menu, "STAMP").visual_mark).toBe("STAMP");
  });

  test("rejects one that is not, and says WHY it was removed", () => {
    const menu = { cards: [{ preset_code: "STAMP" }], blocked: [{ preset_code: "CERTIFIED", reason: "FEATURE_OFF" }] };
    expect(() => presets.assertAllowed(menu, "CERTIFIED")).toThrow(/FEATURE_OFF/);
    expect(() => presets.assertAllowed(menu, "DRAWN")).toThrow(/NOT_IN_MENU/);
  });
});

describe("the doc-type ceiling", () => {
  test("an unregistered type is not signable — the conservative default", () => {
    expect(signaturePolicyFor("SOMETHING_NEW")).toEqual({ signable: false, allowsQes: false, allowsWet: false });
  });

  /**
   * REGRESSION, same class as the canonical.js CodeQL finding. The ceiling was
   * `SIGNATURE_CEILING[docType] || NOT_SIGNABLE`, and for an Object.prototype
   * name the left side was `Object` — truthy — so the fallback never fired and
   * this returned a FUNCTION where its contract promises an object. Nothing
   * broke downstream, because every property read off it came back undefined
   * and read as "not allowed". That is luck, and luck is not a control.
   */
  test.each(["constructor", "toString", "valueOf", "__proto__", "hasOwnProperty"])(
    "Object.prototype member %s gets the not-signable ceiling, not a function",
    (probe) => {
      const ceiling = signaturePolicyFor(probe);
      expect(typeof ceiling).toBe("object");
      expect(ceiling).toEqual({ signable: false, allowsQes: false, allowsWet: false });
    },
  );

  test("the employment contract is the one type that may not be wet-signed", () => {
    expect(signaturePolicyFor("EMPLOYMENT_CONTRACT").allowsWet).toBe(false);
    expect(signaturePolicyFor("DELIVERY_NOTE").allowsWet).toBe(true);
  });

  test("QES is off for the high-volume operational documents that would rack up fees", () => {
    expect(signaturePolicyFor("DELIVERY_NOTE").allowsQes).toBe(false);
    expect(signaturePolicyFor("TRANSIT_ORDER").allowsQes).toBe(false);
    expect(signaturePolicyFor("EMPLOYMENT_CONTRACT").allowsQes).toBe(true);
  });
});
