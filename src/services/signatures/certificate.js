/**
 * The Certificate of Completion — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.7,
 * Q3 = A.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * READ §2.2 BEFORE CHANGING ANYTHING HERE.
 *
 * There is no PAdES seal in this product. This document and the
 * `immutable_ledger` trail are the ENTIRE evidentiary case. Every other part
 * of this programme degrades gracefully if it is missing; this one is the
 * deliverable Q3 = A depends on, and §6.7 says PR-3 MUST NOT ship without it.
 *
 * So it is built to that standard: the FULL hashes rather than the seal's
 * truncated sixteen, every party with the provenance of their address, every
 * signing act with the evidence actually collected, the OTP challenge behind
 * each one, and the ledger timeline with its correlation ids.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── It is generated ONCE ───────────────────────────────────────────────────
 * A regenerated certificate produces different bytes — Puppeteer stamps
 * /CreationDate — and therefore a different artifact hash, so two "copies" of
 * one certificate would disagree about their own fingerprint. `generate()` is
 * idempotent on `request_id` and returns the existing vault row.
 *
 * ── What it does NOT print ─────────────────────────────────────────────────
 * A full IP, unless the tenant has switched `certificate_full_ip` on (§3.13).
 * The default is masked: the certificate is an evidence document, but it is
 * also a SHAREABLE one — it goes to the counterparty, and often to their
 * lawyer. The safer default plus an explicit switch is the right shape for
 * something that travels.
 */
"use strict";

const canonical = require("./canonical");
const tokens = require("./tokens");
const summary = require("./summary");
const { maskIp, coarseUserAgent } = require("./mask");
const { getSetting } = require("../../shared/config/settings");

const t = (pair, lang) => (lang === "en" ? pair.en : pair.fr);
const lang = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

/** Both zones, always. A dispute across borders needs the offset stated. */
function stamp(value, timezone) {
  if (!value) return { utc: "", local: "" };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { utc: String(value), local: "" };
  const utc = d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  let local = "";
  try {
    local = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC", dateStyle: "medium", timeStyle: "medium", timeZoneName: "short",
    }).format(d);
  } catch {
    /* @silent:parse — an unknown tenant timezone must not stop an evidence
       document rendering. The UTC stamp above is the authoritative one; the
       local rendering is the courtesy. */
  }
  return { utc, local };
}

/**
 * Assemble everything §6.7 requires, in its stated order.
 *
 * PURE apart from the two settings reads: it takes rows and returns a struct.
 * The template renders it, the job vaults it, and this stays testable without
 * a browser — which matters, because the assertion worth making about a
 * certificate is that a FIELD IS PRESENT, not that it is at a pixel.
 */
async function build(client, { request, parties, signatures, otps, ledger, entity, language = "fr", baseUrl = "" }) {
  const L = lang(language);
  const timezone = await getSetting(client, "locale", "timezone", "Africa/Douala");
  const fullIp = await getSetting(client, "signature_policy", "certificate_full_ip", false);
  const showIp = (ip) => (fullIp === true ? String(ip || "") : maskIp(ip));

  const otpByParty = new Map();
  for (const o of otps || []) {
    if (!otpByParty.has(o.party_id)) otpByParty.set(o.party_id, []);
    otpByParty.get(o.party_id).push(o);
  }
  const sigByParty = new Map((signatures || []).map((s) => [s.signature_request_id ? s.signer_email : null, s]));

  // 1. Document identity — the FULL hashes, not the seal's sixteen. An
  //    unlabelled fragment invites a reader to think it is the whole digest;
  //    an evidence document should carry the digest itself.
  const payload = (signatures && signatures[0] && signatures[0].content_payload) || null;
  const asSigned = payload ? summary.summarise(request.doc_type, payload, L) : null;

  const document = {
    doc_type: request.doc_type,
    reference: (payload && payload.number) || request.entity_ref,
    entity_ref: request.entity_ref,
    document_vault_id: request.document_vault_id || null,
    payload_version: request.payload_version,
    content_hash: request.content_hash,
    artifact_hash: (signatures && signatures[0] && signatures[0].artifact_hash) || null,
    as_signed: asSigned,
  };

  // 2. Every party, with the PROVENANCE of their address. §6.3: the reader
  //    gets to weigh an override; the system does not pretend the two kinds
  //    of address are identical.
  const partyRows = (parties || []).map((p) => ({
    sequence_no: p.sequence_no,
    party_kind: p.party_kind,
    full_name: p.full_name,
    party_role: p.party_role || null,
    email: p.email,
    source: p.source,
    source_words: p.source === "ON_FILE"
      ? t({ fr: "Adresse figurant au dossier du tenant", en: "Address held on file by the issuer" }, L)
      : t({ fr: "Adresse saisie par un utilisateur du tenant", en: "Address entered by a user of the issuer" }, L),
    source_ref: p.source_ref || null,
    override_by: p.override_by_user_name || null,
    override_reason: p.override_reason || null,
    status: p.status,
    decline_reason: p.decline_reason || null,
    sent_at: stamp(p.sent_at, timezone),
    viewed_at: stamp(p.viewed_at, timezone),
    settled_at: stamp(p.settled_at, timezone),
  }));

  // 3. Every signing act, with the evidence ACTUALLY collected (§1.3(b)) —
  //    never what the preset asked for.
  const acts = (signatures || []).map((s) => ({
    signer_name: s.signer_name,
    signer_role: s.signer_role || null,
    signer_email: s.signer_email || null,
    party: s.party,
    identity_source: s.identity_source,
    // §1.3(d), in the terms the guide insists on.
    identity_words: s.identity_source === "SESSION"
      ? t({
        fr: "Nom résolu depuis un compte authentifié",
        en: "Name resolved from an authenticated account",
      }, L)
      : t({
        fr: "Nom déclaré par le signataire ; adresse prouvée par code",
        en: "Name claimed by the signer; address proved by emailed code",
      }, L),
    preset_code: s.preset_code,
    visual_mark: s.visual_mark,
    assurance_level: s.assurance_level,
    sign_reason: s.sign_reason || null,
    signed_at: stamp(s.signed_at, timezone),
    ip: showIp(s.ip),
    ip_masked: fullIp !== true,
    user_agent: s.user_agent || null,
    device: coarseUserAgent(s.user_agent, L),
    content_hash: s.content_hash,
    verify_code: tokens.formatCode(s.verify_code),
  }));

  // 4. The identity proof itself. This is the part a dispute turns on, so it
  //    carries the address the code went TO — snapshotted at send time, not
  //    re-derived from a contact record that may have been edited since.
  const challenges = (otps || []).map((o) => ({
    otp_id: o.otp_id,
    party_name: o.full_name || null,
    sequence_no: o.sequence_no || null,
    sent_to: o.sent_to,
    sent_at: stamp(o.created_at, timezone),
    verified_at: stamp(o.verified_at, timezone),
    attempts: o.attempts,
    resends: o.resends,
    // The binding, printed: a reader can see that the code was tied to THIS
    // payload and could not have been replayed from another document.
    bound_to_content_hash: o.content_hash,
  }));

  // 5. The timeline, with correlation ids, so a reader can ask the issuer for
  //    the logs behind any single line.
  const timeline = (ledger || []).map((row) => ({
    action: row.action,
    actor: row.actor_name_snapshot || null,
    at: stamp(row.created_at, timezone),
    request_id: row.request_id || null,
  }));

  // 6. How to re-check it, independently, a decade from now.
  const primary = (signatures || [])[0];
  const verification = primary
    ? {
      url: baseUrl ? `${baseUrl}/v/${tokens.normaliseCode(primary.verify_code)}` : null,
      code: tokens.formatCode(primary.verify_code),
      instructions: t({
        fr: "Saisissez ce code sur la page de vérification de l'émetteur, ou scannez le QR code imprimé sur le document.",
        en: "Enter this code on the issuer's verification page, or scan the QR code printed on the document.",
      }, L),
    }
    : null;

  // 7. Who issued it, so a reader can reach the company directly rather than
  //    through whoever handed them the paper.
  const issuer = entity
    ? {
      legal_name: entity.legal_name,
      rccm: entity.rccm || null,
      niu: entity.niu || null,
      address: entity.address || null,
    }
    : null;

  return {
    language: L,
    timezone,
    generated_at: stamp(new Date(), timezone),
    request_id: request.request_id,
    completed_at: stamp(request.completed_at, timezone),
    document,
    parties: partyRows,
    acts,
    challenges,
    timeline,
    verification,
    issuer,
    // Signature count as a claim of its own: "2 of 2" on the cover answers the
    // single most common question about a countersigned document.
    chain: { signed: acts.length, of: partyRows.length },
  };
}

/**
 * Recompute the content hash from the live record, for the certificate's own
 * "was this still true when we issued it?" line.
 *
 * Returns null rather than throwing: a certificate must be issuable for a
 * document that has since been archived, and "we could not re-check at issue
 * time" is a fact worth printing rather than a reason to withhold the
 * evidence document entirely.
 */
function recheck(docType, liveDoc, version) {
  try {
    return canonical.hash(docType, liveDoc, version);
  } catch {
    /* @silent:parse — an unloadable or unregistered document cannot be
       re-hashed. The certificate says so rather than failing to exist. */
  }
  return null;
}

module.exports = { build, recheck, stamp };
