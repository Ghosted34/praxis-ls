"use strict";

/**
 * The public verification portal — doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4,
 * §5.5, and the acceptance criteria in §5.8.
 *
 * The tests that matter most here are the negative ones. A portal that shows
 * the right thing for a valid document and ALSO leaks for an invalid one has
 * failed at the only job it has, and every leak in this file's history was in
 * the second case: a prefix match that accepted four characters, an oracle that
 * distinguished "malformed" from "never existed", a live query that answered a
 * March scan with September's figures.
 */

const canonical = require("../../src/services/signatures/canonical");
const fixtures = require("../fixtures/signature-canonical.fixtures");

const service = require("../../src/modules/vault/document_verification/document_verification.service");
const sigService = require("../../src/modules/vault/document_signature/document_signature.service");

const CODE = "A4B7K92MXQ1P";
const OTHER_CODE = "B5C8M03NYR2Q";

const PAYLOAD = canonical.canonical("FINAL_INVOICE", fixtures.FINAL_INVOICE);
const CONTENT_HASH = canonical.hash("FINAL_INVOICE", fixtures.FINAL_INVOICE);

function makeSignature(over = {}) {
  return {
    signature_id: "11111111-1111-1111-1111-111111111111",
    entity_ref: "final_invoice:abc",
    doc_type: "FINAL_INVOICE",
    document_vault_id: "22222222-2222-2222-2222-222222222222",
    payload_version: 1,
    content_hash: CONTENT_HASH,
    content_payload: PAYLOAD,
    artifact_hash: "deadbeef",
    assurance_level: "AES_OTP",
    visual_mark: "STAMP",
    preset_code: "STAMP",
    sign_reason: "Approved for dispatch",
    party: "INTERNAL",
    identity_source: "SESSION",
    signer_name: "Jean Mbarga",
    signer_role: "Commercial Director",
    signer_email: "jean@example.cm",
    verify_code: CODE,
    signed_at: new Date("2026-03-03T13:35:00Z"),
    ip: "197.210.44.12",
    user_agent: "Mozilla/5.0 (iPhone) Mobile Safari",
    revoked_at: null,
    revoke_reason: null,
    ...over,
  };
}

/**
 * A tenant connection that answers the handful of queries this path makes.
 * `scans` is the in-memory signature_scan table so the new-IP and anomaly
 * assertions run against real inserts rather than a spy.
 */
function makeClient({
  signature = makeSignature(),
  vaultHash = "deadbeef",
  settings = {},
  scans = [],
} = {}) {
  const emitted = [];
  const audited = [];
  const client = {
    emitted,
    audited,
    scans,
    query: async (sql, params = []) => {
      if (/FROM document_signature\b[\s\S]*verify_code = \$1/.test(sql)) {
        return { rows: signature && signature.verify_code === params[0] ? [signature] : [] };
      }
      if (/FROM document_signature\b[\s\S]*signature_id = \$1/.test(sql)) {
        return { rows: signature ? [signature] : [] };
      }
      if (/FROM document_vault WHERE doc_id/.test(sql)) {
        return { rows: vaultHash ? [{ doc_id: params[0], content_hash: vaultHash, version_no: 1, status: "VERIFIED" }] : [] };
      }
      if (/FROM corporate_entity/.test(sql)) {
        return { rows: [{ legal_name: "Smart Logistics SARL", trading_name: null, rccm: "RC/DLA/2019/B/1234", niu: "M0119...", address: "Douala", country_code: "CM" }] };
      }
      if (/FROM signature_preset WHERE preset_code/.test(sql)) {
        return { rows: [{ preset_code: "STAMP", label_en: "Digital stamp", label_fr: "Cachet numérique", blurb_en: "b", blurb_fr: "b", assurance_level: "AES_OTP", visual_mark: "STAMP", tier_label: "1" }] };
      }
      if (/FROM setting/.test(sql)) {
        const key = params[1];
        return Object.prototype.hasOwnProperty.call(settings, key)
          ? { rows: [{ value: settings[key] }] }
          : { rows: [] };
      }
      if (/SELECT 1 FROM signature_scan/.test(sql)) {
        return { rows: scans.some((s) => s.ip === params[1]) ? [{ "?column?": 1 }] : [] };
      }
      if (/INSERT INTO signature_scan/.test(sql) || /insert into signature_scan/i.test(sql)) {
        scans.push({ ip: params[1], via: params[4] });
        return { rows: [{ scan_id: `scan-${scans.length}` }] };
      }
      if (/count\(\*\)::int AS n FROM signature_scan/.test(sql)) {
        return { rows: [{ n: scans.length }] };
      }
      if (/INSERT INTO immutable_ledger/.test(sql)) {
        audited.push(params);
        return { rows: [] };
      }
      if (/INSERT INTO event_log/.test(sql)) {
        emitted.push(params[0]);
        return { rows: [] };
      }
      if (/FROM event_type/.test(sql)) return { rows: [{ is_security_critical: false, is_approvable: false }] };
      return { rows: [] };
    },
  };
  return client;
}

/** The live record the portal recomputes against. Injected, not queried. */
function withLiveDoc(doc) {
  const spy = jest.spyOn(sigService, "loadDoc");
  if (doc === null) spy.mockRejectedValue(new Error("no loader"));
  else spy.mockResolvedValue(doc);
  return spy;
}

afterEach(() => jest.restoreAllMocks());

/** The AppError code a rejected call carries. */
async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code || err.message;
  }
}

describe("§5.8 criterion 3 — unknown is ONE answer", () => {
  test("a malformed code and a never-existed code are indistinguishable", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient();

    const malformed = await service.resolve(client, { code: "nope" }).catch((e) => e);
    const neverExisted = await service.resolve(client, { code: OTHER_CODE }).catch((e) => e);

    // Same status, same code, same message — the response bodies a caller sees
    // are byte-identical. Anything else is an oracle confirming which of 2^60
    // codes are real, and the limiter is the only other thing in the way.
    expect(malformed.status).toBe(404);
    expect(neverExisted.status).toBe(404);
    expect(malformed.code).toBe(neverExisted.code);
    expect(malformed.message).toBe(neverExisted.message);
  });

  test("a malformed code costs no database round-trip", async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, "query");
    await codeOf(service.resolve(client, { code: "!!!" }));
    expect(spy).not.toHaveBeenCalled();
  });

  test("a code that is well-formed but wrong does not 422", async () => {
    // A 422 here would tell a caller their guess had the RIGHT SHAPE, which is
    // half the oracle back again.
    expect(await codeOf(service.resolve(makeClient(), { code: OTHER_CODE }))).toBe("NOT_FOUND");
  });

  test("nothing is logged for a code that resolves to nothing", async () => {
    const client = makeClient();
    await codeOf(service.resolve(client, { code: OTHER_CODE }));
    expect(client.scans).toEqual([]);
  });
});

describe("the two verdicts, on separate lines", () => {
  test("an untouched document passes both", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.status).toBe("VALID");
    expect(out.verdicts.map((v) => [v.key, v.state])).toEqual([["content", "PASS"], ["artifact", "PASS"]]);
  });

  test("§5.8 criterion 5 — an amended document fails CONTENT and passes ARTIFACT", async () => {
    // The pair is informative, not contradictory: "this is our file, and the
    // record behind it has moved on".
    withLiveDoc({ ...fixtures.FINAL_INVOICE, number: "FCT-2026-9999" });
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.status).toBe("AMENDED");
    expect(out.verdicts.find((v) => v.key === "content").state).toBe("FAIL");
    expect(out.verdicts.find((v) => v.key === "artifact").state).toBe("PASS");
    expect(out.changes.find((c) => c.field === "number")).toMatchObject({
      before: "FCT-2026-0001", after: "FCT-2026-9999",
    });
  });

  test("an unreadable record reads UNKNOWN, never AMENDED", async () => {
    // "We cannot check" and "it changed" are different claims, and only one of
    // them accuses somebody of something.
    withLiveDoc(null);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.verdicts.find((v) => v.key === "content").state).toBe("UNKNOWN");
    expect(out.status).toBe("VALID");
  });

  test("bytes that no longer match the vaulted copy fail the ARTIFACT verdict alone", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient({ vaultHash: "0000" }), { code: CODE, lang: "en" });
    expect(out.verdicts.find((v) => v.key === "content").state).toBe("PASS");
    expect(out.verdicts.find((v) => v.key === "artifact").state).toBe("FAIL");
  });

  test("a document not yet rendered says so rather than failing", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient({ signature: makeSignature({ artifact_hash: null }) });
    const out = await service.resolve(client, { code: CODE, lang: "en" });
    expect(out.verdicts.find((v) => v.key === "artifact").state).toBe("UNKNOWN");
  });
});

describe("§5.8 criterion 4 — a revoked signature answers, and says revoked", () => {
  test("200 with the original signer and the reason still visible", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient({
      signature: makeSignature({ revoked_at: new Date("2026-04-01T00:00:00Z"), revoke_reason: "Superseded by FCT-2026-0002" }),
    });
    const out = await service.resolve(client, { code: CODE, lang: "en" });
    // Not a 404: the holder of a PDF printed before the revocation must be told
    // it was withdrawn, not left to conclude the link is merely broken.
    expect(out.status).toBe("REVOKED");
    expect(out.signature.signed.name).toBe("Jean Mbarga");
    expect(out.signature.revoke_reason).toBe("Superseded by FCT-2026-0002");
  });
});

describe("the summary is the document AS SIGNED — Q12 = B", () => {
  test("it renders the STORED payload even when the live record has moved on", async () => {
    // The heart of §1.5(d). A March waybill scanned in September must show
    // March's figures — the ones on the paper in the reader's hand.
    withLiveDoc({ ...fixtures.FINAL_INVOICE, number: "FCT-2026-9999", party: { name: "SOMEBODY ELSE SARL", lines: [] } });
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    const byKey = Object.fromEntries(out.as_signed.fields.map((f) => [f.key, f.value]));
    expect(byKey.number).toBe("FCT-2026-0001");
    expect(byKey.party).toBe("CIMENCAM SA");
    expect(JSON.stringify(out.as_signed)).not.toContain("SOMEBODY ELSE");
  });

  test("an unregistered doc type shows the verdicts and the signer only", async () => {
    withLiveDoc(null);
    const client = makeClient({ signature: makeSignature({ doc_type: "PAYSLIP" }) });
    const out = await service.resolve(client, { code: CODE, lang: "en" });
    expect(out.as_signed).toBeNull();
    expect(out.signature.signed.name).toBe("Jean Mbarga");
  });
});

describe("§3.13 — no full IP reaches the page", () => {
  test("the signer's address is masked to two octets", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.signature.signed.ip).toBe("197.210.***.***");
    expect(JSON.stringify(out)).not.toContain("197.210.44.12");
  });

  test("the user agent is coarsened to a device class, not echoed", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.signature.signed.device).toBe("Mobile browser");
    expect(JSON.stringify(out)).not.toContain("Mozilla/5.0");
  });

  test("the device class is bilingual — §3.14 covers every word a stranger reads", async () => {
    // It was English-only, and the French portal rendered
    // "Appareil · Mobile browser". Invisible in the JSX, obvious in a render.
    withLiveDoc(fixtures.FINAL_INVOICE);
    const fr = await service.resolve(makeClient(), { code: CODE, lang: "fr" });
    expect(fr.signature.signed.device).toBe("Navigateur mobile");
  });
});

describe("§5.8 criterion 8 — scan logging, new IP and anomaly", () => {
  test("two scans from the same IP write two rows and set is_new_ip once", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient({ settings: { notify_on_scan: true } });

    const first = await service.resolve(client, { code: CODE, ip: "41.202.1.9" });
    const second = await service.resolve(client, { code: CODE, ip: "41.202.1.9" });

    expect(client.scans).toHaveLength(2);
    expect(first.scan.is_new_ip).toBe(true);
    expect(second.scan.is_new_ip).toBe(false);
    expect(client.emitted.filter((k) => k === "document_signature.scanned_new_ip")).toHaveLength(1);
  });

  test("the new-IP notification is OFF unless the tenant switched it on", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient(); // notify_on_scan unset → default false
    await service.resolve(client, { code: CODE, ip: "41.202.1.9" });
    expect(client.emitted).not.toContain("document_signature.scanned_new_ip");
  });

  test("the anomaly fires past the threshold, whatever the notification toggle says", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    // Threshold 2, and two scans already in the window: this one is the third.
    const client = makeClient({
      settings: { scan_anomaly_threshold: 2 },
      scans: [{ ip: "1.1.1.1" }, { ip: "2.2.2.2" }],
    });
    await service.resolve(client, { code: CODE, ip: "3.3.3.3" });
    expect(client.emitted).toContain("document_signature.scan_anomaly");
  });

  test("it does NOT fire at the threshold — that many scans are still ordinary", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient({ settings: { scan_anomaly_threshold: 2 }, scans: [{ ip: "1.1.1.1" }] });
    await service.resolve(client, { code: CODE, ip: "3.3.3.3" });
    expect(client.emitted).not.toContain("document_signature.scan_anomaly");
  });

  test("every resolve also writes the ledger copy", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient();
    await service.resolve(client, { code: CODE, ip: "41.202.1.9" });
    // Two writes, deliberately (§5.5): the ledger is the evidentiary record,
    // signature_scan is the projection the window query needs.
    expect(client.audited.length).toBeGreaterThan(0);
    expect(client.scans).toHaveLength(1);
  });

  test("a visitor still gets an answer when the telemetry fails", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const client = makeClient();
    const real = client.query;
    client.query = async (sql, params) => {
      if (/signature_scan/i.test(sql)) throw new Error("table is gone");
      return real(sql, params);
    };
    const out = await service.resolve(client, { code: CODE, ip: "41.202.1.9" });
    // Logging a scan is how the tenant learns something. Refusing to answer is
    // how the product fails the only person on the page.
    expect(out.status).toBe("VALID");
    expect(out.scan.is_new_ip).toBe(false);
  });

  test("an unknown `via` cannot reach the CHECK-constrained column", async () => {
    // `via` arrives on the query string. A plain object literal would resolve
    // VIA["constructor"] to a truthy, callable value that sails past `|| "QR"`.
    expect(service.viaOf("constructor")).toBe("QR");
    expect(service.viaOf("__proto__")).toBe("QR");
    expect(service.viaOf("code")).toBe("CODE");
    expect(service.viaOf(undefined)).toBe("QR");
  });
});

describe("§3.14 — the page answers in the reader's language, and defaults to FR", () => {
  test("no ?lang means French, because this is a Cameroonian product", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE });
    expect(out.language).toBe("fr");
    expect(out.verdicts[0].label).toBe("Contenu");
  });

  test("?lang=en switches every server-rendered string", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.language).toBe("en");
    expect(out.verdicts[0].label).toBe("Content");
    expect(out.as_signed.title).toBe("Invoice");
  });

  test("the assurance level is plain language everywhere a person reads it", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const out = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(out.signature.signed.method).toBe("Verified by email code");

    // The enum survives in exactly ONE place: `card.assurance_level`, which is
    // the shared SignatureCard's own input — the component translates it
    // through signature-vocab. Anywhere else on this payload is prose a
    // stranger reads, and "AES_OTP" is not a word a court should have to meet.
    const { card, ...rest } = out.signature;
    expect(card.assurance_level).toBe("AES_OTP");
    expect(JSON.stringify({ ...out, signature: rest })).not.toContain("AES_OTP");
  });
});

describe("the card on the portal is the vault's card", () => {
  test("it comes from signature_preset, in the reader's language", async () => {
    withLiveDoc(fixtures.FINAL_INVOICE);
    const fr = await service.resolve(makeClient(), { code: CODE, lang: "fr" });
    const en = await service.resolve(makeClient(), { code: CODE, lang: "en" });
    expect(fr.signature.card.label).toBe("Cachet numérique");
    expect(en.signature.card.label).toBe("Digital stamp");
    // The shape SignatureCard renders. A tenant that renames a card renames it
    // here too, which is why the portal does not carry its own labels.
    expect(en.signature.card).toMatchObject({ preset_code: "STAMP", tier: "1", assurance_level: "AES_OTP" });
  });
});
