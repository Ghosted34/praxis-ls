"use strict";

/**
 * The covering email is part of the document, and it is monolingual.
 *
 * A French sheet arriving under an English subject line is the same defect as
 * "Ordre de transit / Transit order" printed on the page — the one the tenant
 * complained about — wearing an envelope. So the wording lives beside the
 * template that renders the sheet, as {fr,en} pairs resolved by the same `k.t`,
 * and these tests hold it to that.
 *
 * They also pin the thing a wording change is most likely to break quietly: a
 * document raised outside a file has no reference, and a sentence that trails
 * off into "relatif au dossier " is worse than one that never mentions one.
 */

const registry = require("../../src/services/documents/templates/registry");

const ENTITY = { legal_name: "SMART LOGISTICS AND SERVICES LTD" };
const copy = (docType, data, language) =>
  registry.emailCopy(docType, data, { language, entity: ENTITY });

const TO = { number: "SLAS-TRO-2026-0019", dossier_ref: "SL6721864SM" };
const DN = { number: "DN-2026-0052", dossier_ref: "SBX-2026-0001" };

describe("the email a document goes out under", () => {
  test("a French document gets a French subject and body, with no English in it", () => {
    const c = copy("TRANSIT_ORDER", TO, "fr");
    expect(c.subject).toContain("Ordre de transit");
    expect(c.subject).toContain(TO.number);
    expect(c.body).toContain("Veuillez trouver ci-joint");
    expect(c.body).toContain(ENTITY.legal_name);
    for (const english of ["Transit order", "Please find", "Kind regards", "file "]) {
      expect(c.subject + c.body).not.toContain(english);
    }
  });

  test("an English document gets an English subject and body, with no French in it", () => {
    const c = copy("DELIVERY_NOTE", DN, "en");
    expect(c.subject).toContain("Delivery note");
    expect(c.body).toContain("Please find attached");
    for (const french of ["Bon de livraison", "Veuillez", "Cordialement", "dossier"]) {
      expect(c.subject + c.body).not.toContain(french);
    }
  });

  test("each document asks for the thing it exists to get back", () => {
    // Not interchangeable boilerplate. The transit order is an AUTHORISATION —
    // nothing can be declared until it returns signed — and the delivery note
    // needs the client's reserves written on it at the gate. An email that says
    // only "please find attached" is how neither comes back.
    expect(copy("TRANSIT_ORDER", TO, "fr").body).toMatch(/signé et cacheté/);
    expect(copy("TRANSIT_ORDER", TO, "fr").body).toMatch(/dédouanement/);
    expect(copy("TRANSIT_ORDER", TO, "en").subject).toMatch(/signature required/);
    expect(copy("DELIVERY_NOTE", DN, "fr").body).toMatch(/réserves/);
    expect(copy("DELIVERY_NOTE", DN, "en").body).toMatch(/reservations/);
  });

  test("a document with no file reference does not trail off into one", () => {
    // `[[ … ]]` drops the whole segment when a token inside it is empty.
    const c = copy("DELIVERY_NOTE", { number: "DN-1" }, "fr");
    expect(c.subject).toBe("Bon de livraison DN-1");
    expect(c.body).toContain("le bon de livraison DN-1.");
    expect(c.body).not.toContain("dossier");
    expect(c.body).not.toMatch(/\s\./);
  });

  test("a doc type with no wording of its own returns null", () => {
    // The honest answer: the composer opens empty. Inventing "please find
    // attached" for a payslip would put our words on a document nobody wrote
    // them for.
    expect(copy("PAYSLIP", { number: "P-1" }, "fr")).toBeNull();
    expect(copy("NOT_A_DOC_TYPE", {}, "fr")).toBeNull();
  });

  test("an unfilled token leaves a gap, never its own braces", () => {
    // A typo in the wording above should read as a missing word to the client,
    // not as machinery showing through.
    expect(registry.fillCopy("Bonjour {nobody}, voici {number}.", { number: "X" }))
      .toBe("Bonjour , voici X.");
    expect(registry.fillCopy("{a}{b}", {})).toBe("");
  });

  test("the optional segment survives when its token is present", () => {
    expect(registry.fillCopy("A[[ — dossier {ref}]] B", { ref: "SL-1" }))
      .toBe("A — dossier SL-1 B");
    expect(registry.fillCopy("A[[ — dossier {ref}]] B", { ref: "" })).toBe("A B");
  });

  test("both doc types carry both languages, and neither is a slash pair", () => {
    for (const docType of ["TRANSIT_ORDER", "DELIVERY_NOTE"]) {
      const { email } = registry.get(docType);
      for (const part of [email.subject, email.body]) {
        expect(part.fr).toBeTruthy();
        expect(part.en).toBeTruthy();
        expect(part.fr).not.toBe(part.en);
        // The defect this whole convention exists to prevent.
        expect(part.fr).not.toContain(" / ");
      }
    }
  });

  test("the entity's own name signs the message", () => {
    // It goes to a client, from a company. A covering note signed by nobody
    // reads as machine-generated, which is what it must not look like.
    const named = copy("DELIVERY_NOTE", DN, "fr");
    expect(named.body.trimEnd().endsWith(ENTITY.legal_name)).toBe(true);
    // …and an entity we cannot name degrades to a note that simply ends,
    // rather than one signed "undefined".
    const anon = registry.emailCopy("DELIVERY_NOTE", DN, { language: "fr", entity: {} });
    expect(anon.body).not.toContain("undefined");
  });
});
