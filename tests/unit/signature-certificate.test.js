"use strict";

/**
 * The Certificate of Completion — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.7,
 * and §6.9 criterion 9.
 *
 * ── Why this test is a list of "is this field present" ─────────────────────
 * Read §2.2: with no PAdES seal, this document and the immutable_ledger trail
 * are the ENTIRE evidentiary case. §6.7 mandates seven sections in a stated
 * order, and each one is there because a dispute would ask for it. A missing
 * field is not a cosmetic regression — it is a question the tenant cannot
 * answer three years later.
 *
 * So the assertions are about CONTENT, not layout. The one layout claim worth
 * making is that the hashes are printed WHOLE: everywhere else in this
 * programme a digest is truncated to sixteen and labelled (§3.12), because an
 * unlabelled fragment invites a reader to think it is the whole thing. Here
 * the whole thing is the point — a reader is meant to be able to recompute it.
 */

const certificate = require("../../src/services/signatures/certificate");
const registry = require("../../src/services/documents/templates/registry");
const canonical = require("../../src/services/signatures/canonical");
const fixtures = require("../fixtures/signature-canonical.fixtures");

const CONTENT_HASH = canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE);
const ARTIFACT_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const settings = (rows = {}) => ({
  query: async (sql, params = []) => {
    if (/FROM setting/.test(sql)) {
      const key = params[1];
      return Object.prototype.hasOwnProperty.call(rows, key) ? { rows: [{ value: rows[key] }] } : { rows: [] };
    }
    return { rows: [] };
  },
});

const INPUT = {
  request: {
    request_id: "3f9c1a20-1111-2222-3333-444444444444",
    entity_ref: "final_invoice:abc",
    doc_type: "FINAL_INVOICE",
    document_vault_id: "doc-1",
    payload_version: 1,
    content_hash: CONTENT_HASH,
    completed_at: new Date("2026-03-11T09:14:02Z"),
  },
  parties: [
    {
      sequence_no: 1, party_kind: "ISSUER", source: "ON_FILE", source_ref: "app_user:u1",
      full_name: "Jean Mbarga", party_role: "Commercial Director", email: "jean@smartls.cm",
      status: "SIGNED", sent_at: null, viewed_at: null, settled_at: new Date("2026-03-03T13:35:00Z"),
    },
    {
      sequence_no: 2, party_kind: "COUNTERPARTY", source: "OVERRIDE",
      override_by_user_name: "Paul Fotso", override_reason: "Their MD is not in our CRM",
      full_name: "Aïssatou Njoya", party_role: "Procurement Manager", email: "aissatou@cimencam.cm",
      status: "SIGNED", sent_at: new Date("2026-03-04T08:00:00Z"), settled_at: new Date("2026-03-11T09:14:02Z"),
    },
  ],
  signatures: [
    {
      signer_name: "Aïssatou Njoya", signer_role: "Procurement Manager", signer_email: "aissatou@cimencam.cm",
      party: "EXTERNAL", identity_source: "DECLARED", preset_code: "DRAWN", visual_mark: "DRAWN",
      assurance_level: "AES_OTP", sign_reason: "Goods received",
      signed_at: new Date("2026-03-11T09:14:02Z"), ip: "197.210.44.12",
      user_agent: "Mozilla/5.0 (iPhone) Mobile Safari",
      content_hash: CONTENT_HASH, artifact_hash: ARTIFACT_HASH, verify_code: "A4B7K92MXQ1P",
      content_payload: canonical.canonical("FINAL_INVOICE", fixtures.FINAL_INVOICE),
    },
  ],
  otps: [
    {
      otp_id: "otp-1", full_name: "Aïssatou Njoya", sequence_no: 2, sent_to: "aissatou@cimencam.cm",
      created_at: new Date("2026-03-11T09:10:00Z"), verified_at: new Date("2026-03-11T09:11:30Z"),
      attempts: 1, resends: 0, content_hash: CONTENT_HASH,
    },
  ],
  ledger: [
    { action: "document_signature.requested", actor_name_snapshot: "Paul Fotso", created_at: new Date("2026-03-03T12:00:00Z"), request_id: "req-abc" },
    { action: "document_signature.signed", actor_name_snapshot: null, created_at: new Date("2026-03-11T09:14:02Z"), request_id: "req-def" },
  ],
  entity: { legal_name: "SMART LOGISTICS SARL", rccm: "RC/DLA/2019/B/1234", niu: "M011912345678K", address: "Bonanjo, Douala" },
  baseUrl: "https://smartls.praxisls.com",
};

describe("§6.7 — every mandated section is present", () => {
  test("1. document identity, with the FULL hashes", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.document.doc_type).toBe("FINAL_INVOICE");
    expect(d.document.entity_ref).toBe("final_invoice:abc");
    expect(d.document.document_vault_id).toBe("doc-1");
    expect(d.document.payload_version).toBe(1);
    // Whole, not truncated to sixteen. A reader is meant to recompute these.
    expect(d.document.content_hash).toBe(CONTENT_HASH);
    expect(d.document.content_hash).toHaveLength(64);
    expect(d.document.artifact_hash).toBe(ARTIFACT_HASH);
  });

  test("2. every party, with the PROVENANCE of their address", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.parties).toHaveLength(2);
    const [issuer, counterparty] = d.parties;
    expect(issuer.source).toBe("ON_FILE");
    expect(issuer.source_words).toMatch(/on file/i);
    // §6.3: the reader gets to weigh an override; the system does not pretend
    // the two kinds of address are identical.
    expect(counterparty.source).toBe("OVERRIDE");
    expect(counterparty.source_words).toMatch(/entered by/i);
    expect(counterparty.override_by).toBe("Paul Fotso");
    expect(counterparty.override_reason).toBe("Their MD is not in our CRM");
  });

  test("3. every signing act, with the evidence ACTUALLY collected", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    const [act] = d.acts;
    expect(act.assurance_level).toBe("AES_OTP");
    expect(act.preset_code).toBe("DRAWN");
    expect(act.visual_mark).toBe("DRAWN");
    expect(act.sign_reason).toBe("Goods received");
    expect(act.content_hash).toBe(CONTENT_HASH);
    // §1.3(d), in the terms the guide insists on: the name is claimed, the
    // email is proved.
    expect(act.identity_words).toMatch(/claimed by the signer/i);
    expect(act.identity_words).toMatch(/proved/i);
  });

  test("4. the OTP evidence — the part a dispute turns on", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    const [c] = d.challenges;
    expect(c.sent_to).toBe("aissatou@cimencam.cm");
    expect(c.attempts).toBe(1);
    expect(c.resends).toBe(0);
    expect(c.sent_at.utc).toBeTruthy();
    expect(c.verified_at.utc).toBeTruthy();
    // The binding, printed: a reader can see the code was tied to THIS payload
    // and could not have been replayed from another document.
    expect(c.bound_to_content_hash).toBe(CONTENT_HASH);
  });

  test("5. the timeline, with correlation ids", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.timeline).toHaveLength(2);
    expect(d.timeline[0].action).toBe("document_signature.requested");
    // The correlation id is what lets a reader ask the issuer for the logs
    // behind a single line.
    expect(d.timeline[0].request_id).toBe("req-abc");
  });

  test("6. how to re-check it, independently", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.verification.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
    expect(d.verification.code).toBe("A4B7-K92M-XQ1P");
    expect(d.verification.instructions).toMatch(/verification page/i);
  });

  test("7. the issuer's legal identity", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.issuer).toEqual(INPUT.entity);
  });

  test("both timezones on every stamp — a cross-border dispute needs the offset", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.completed_at.utc).toMatch(/UTC$/);
    expect(d.completed_at.local).toBeTruthy();
    expect(d.completed_at.local).not.toBe(d.completed_at.utc);
  });
});

describe("§3.13 — the IP is masked by default, and unmasked only on request", () => {
  test("masked unless the tenant switched certificate_full_ip on", async () => {
    // The certificate is an evidence document, but it is also SHAREABLE — it
    // goes to the counterparty and often to their lawyer. Safer default plus
    // an explicit switch is the right shape for something that travels.
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    expect(d.acts[0].ip).toBe("197.210.***.***");
    expect(d.acts[0].ip_masked).toBe(true);
    expect(JSON.stringify(d)).not.toContain("197.210.44.12");
  });

  test("full when the tenant has switched it on", async () => {
    const d = await certificate.build(settings({ certificate_full_ip: true }), { ...INPUT, language: "en" });
    expect(d.acts[0].ip).toBe("197.210.44.12");
    expect(d.acts[0].ip_masked).toBe(false);
  });
});

describe("§3.14 — bilingual", () => {
  test("the provenance and identity wording changes language", async () => {
    const en = await certificate.build(settings(), { ...INPUT, language: "en" });
    const fr = await certificate.build(settings(), { ...INPUT, language: "fr" });
    expect(fr.parties[0].source_words).not.toBe(en.parties[0].source_words);
    expect(fr.acts[0].identity_words).not.toBe(en.acts[0].identity_words);
    expect(fr.language).toBe("fr");
  });
});

describe("§6.9 criterion 9 — the rendered document carries it all", () => {
  test("the template prints all seven sections", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    const tpl = registry.get("SIGNATURE_CERTIFICATE");
    const html = tpl.build(d, { language: "en", show: { qr: true } }, INPUT.entity);
    const body = html.replace(/<style>[\s\S]*?<\/style>/g, "");

    for (const heading of [
      "1. The document", "2. The parties", "3. The signing acts",
      "4. Identity proof", "5. Event timeline", "6. Independent verification", "7. Issuer",
    ]) {
      expect(body).toContain(heading);
    }
    // The full digests, printed whole.
    expect(body).toContain(CONTENT_HASH);
    expect(body).toContain(ARTIFACT_HASH);
    // The evidence a dispute asks for.
    expect(body).toContain("Their MD is not in our CRM");
    expect(body).toContain("aissatou@cimencam.cm");
    expect(body).toContain("A4B7-K92M-XQ1P");
  });

  test("it carries NO verification block of its own", async () => {
    // The certificate is not a signed document — it is the evidence ABOUT one
    // — and a QR resolving to the certificate itself would be a circle. It
    // prints the SUBJECT document's code instead, in §6.7 item 6.
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    const tpl = registry.get("SIGNATURE_CERTIFICATE");
    const body = tpl.build(d, { language: "en", show: { qr: true } }, INPUT.entity)
      .replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(body).not.toContain("<svg");
    expect(body).not.toContain("foot-vfy");
  });

  test("the masked IP is what reaches the page", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "en" });
    const tpl = registry.get("SIGNATURE_CERTIFICATE");
    const body = tpl.build(d, { language: "en", show: { qr: true } }, INPUT.entity)
      .replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(body).toContain("197.210.***.***");
    expect(body).not.toContain("197.210.44.12");
  });

  test("it renders in French too", async () => {
    const d = await certificate.build(settings(), { ...INPUT, language: "fr" });
    const tpl = registry.get("SIGNATURE_CERTIFICATE");
    const body = tpl.build(d, { language: "fr", show: { qr: true } }, INPUT.entity)
      .replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(body).toContain("1. Le document");
    expect(body).toContain("4. Preuve d'identité");
  });

  test("an unregistered or unloadable document does not stop the certificate existing", () => {
    // "We could not re-check at issue time" is a fact worth printing, not a
    // reason to withhold the evidence document entirely.
    expect(certificate.recheck("PAYSLIP", {}, 1)).toBeNull();
    expect(certificate.recheck("FINAL_INVOICE", fixtures.FINAL_INVOICE, 1)).toBe(CONTENT_HASH);
  });
});
