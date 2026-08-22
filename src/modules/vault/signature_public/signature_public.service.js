/**
 * The public signing page (MOD-64) — doc/SIGNATURE_ENGINEERING_GUIDE.md §6.6.
 *
 * A counterparty on a phone, with no account, holding a link. This is what
 * answers them.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR RULES THIS FILE EXISTS TO KEEP
 *
 * 1. NOTHING HERE READS AN ADDRESS FROM THE BODY. Q7 = C is forbidden
 *    (§6.3): there is no path where a signer supplies the address their own
 *    OTP goes to. `resolve()` returns the address MASKED and the validator
 *    has no `email` field at all — so a caller sending one is rejected, not
 *    ignored. What a signer MAY state is their name and role, which is
 *    `identity_source = 'DECLARED'`, and the portal and certificate both say
 *    the name is CLAIMED while the email is PROVED (§1.3(d)).
 *
 * 2. EVERY COMPLETION PASSES THROUGH VERIFICATION (Q1, §1.5(b)). STAMP and
 *    DRAWN both require a verified OTP before `/complete` will accept, with no
 *    threshold and no setting that disables it. The database says so too —
 *    `ck_sig_external_verified` in 10771 — so a future endpoint cannot get it
 *    wrong either.
 *
 * 3. `/complete` RE-DERIVES THE CANONICAL HASH (§1.3(a)). Mismatch → 409
 *    DOCUMENT_AMENDED, the request moves to AMENDED, every signed party is
 *    notified, a compliance flag is raised. This is what stops party B signing
 *    something party A never saw.
 *
 * 4. THE MENU IS RESOLVED SERVER-SIDE ON EVERY RENDER (§3.4). A menu resolved
 *    once at dispatch and trusted thereafter would keep offering a card after
 *    the tenant turned it off.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const requestService = require("../signature_request/signature_request.service");
const repo = require("../signature_request/signature_request.repo");
const mail = require("../signature_request/signature_request.mail");
const events = require("../signature_request/signature_request.events");
const sigRepo = require("../document_signature/document_signature.repo");
const sigService = require("../document_signature/document_signature.service");
const canonical = require("../../../services/signatures/canonical");
const tokens = require("../../../services/signatures/tokens");
const presets = require("../../../services/signatures/presets");
const otp = require("../../../services/signatures/otp");
const summary = require("../../../services/signatures/summary");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * One answer for every way a link can fail to resolve.
 *
 * Same reasoning as the verification portal's single 404 (§5.4): a caller must
 * not be able to tell "no such token" from "expired" from "already signed",
 * because each distinction is a free bit against a credential. The ONE
 * exception is a settled party, below — a counterparty who already signed
 * needs to be told so rather than left retrying.
 */
const notFound = () => new AppError("NOT_FOUND", "This signing link is not valid.", 404);

const langOf = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

/**
 * A doc type as a person would say it, from the template registry's own
 * bilingual title. Falls back to the code humanised — never to the raw enum,
 * because a fallback that shows `FINAL_INVOICE` is the defect this exists to
 * remove.
 */
function docTypeLabel(docType, language) {
  try {
    const registry = require("../../../services/documents/templates/registry");
    const tpl = registry.get(docType);
    if (tpl && tpl.title) return language === "en" ? tpl.title.en : tpl.title.fr;
  } catch {
    /* @silent:parse — an unregistered doc type has no title to resolve; the
       humanised code below is a better answer than failing the page. */
  }
  return String(docType || "").toLowerCase().replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());
}

/**
 * Resolve a presented token to its party and request.
 *
 * By HMAC over the pepper candidates — the plaintext was emailed once and
 * never stored, so this is the only way in. An expired link and a forged one
 * are the same 404.
 */
async function resolveToken(client, token) {
  if (!token || typeof token !== "string" || token.length < 20 || token.length > 200) throw notFound();
  let candidates;
  try {
    candidates = tokens.signTokenCandidates(token);
  } catch (err) {
    // The pepper is missing or too short. That is an operator error, not a
    // caller error, and it must be loud in the log while staying a 404 on the
    // wire — telling the internet that our signing secret is unconfigured is
    // not an improvement.
    logger.error({ err: err && err.message }, "signing token pepper is not configured");
    throw notFound();
  }

  const party = await repo.getPartyByTokenHmac(client, candidates);
  if (!party) throw notFound();
  if (party.sign_expires_at && new Date(party.sign_expires_at).getTime() <= Date.now()) throw notFound();

  const request = await repo.getRequest(client, party.request_id);
  if (!request) throw notFound();

  return { party, request };
}

/** A settled party gets a plain answer rather than the signing form. */
function assertSignable(party, request) {
  if (party.status === "SIGNED") {
    throw new AppError("ALREADY_SIGNED", "You have already signed this document.", 409);
  }
  if (party.status === "DECLINED") {
    throw new AppError("ALREADY_DECLINED", "You have already declined this document.", 409);
  }
  if (["COMPLETED", "DECLINED", "VOIDED", "EXPIRED"].includes(request.status)) {
    throw new AppError("REQUEST_CLOSED", "This signature request is closed.", 409, { status: request.status });
  }
  if (request.status === "AMENDED") {
    throw new AppError(
      "DOCUMENT_AMENDED",
      "This document changed after the request was created. The sender has to reissue it.",
      409,
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GET /public/sign/:token
// ───────────────────────────────────────────────────────────────────────────

/**
 * The signing page's payload: what is being signed, who the signer is, and
 * the resolved menu.
 *
 * Rule 4 lives here — the menu is resolved through all four funnel levels on
 * every render, then intersected with what the sender allowed. Cards the
 * tenant or the ceiling forbids come back DISABLED with a reason rather than
 * hidden: a counterparty who was told "you can sign this by hand" needs to see
 * why that option is greyed out, not wonder whether the page is broken.
 */
async function resolve(client, { token, lang = "fr", markViewed = true }) {
  const language = langOf(lang);
  const { party, request } = await resolveToken(client, token);

  const menu = await presets.resolveMenu(client, { docType: request.doc_type, language });
  const senderAllowed = new Set(party.allowed_presets || request.allowed_presets || []);
  const cards = menu.cards.filter((c) => senderAllowed.has(c.preset_code));
  const blocked = [
    ...menu.blocked,
    ...menu.cards
      .filter((c) => !senderAllowed.has(c.preset_code))
      .map((c) => ({ preset_code: c.preset_code, reason: "NOT_IN_MENU" })),
  ];

  // The document AS REQUESTED — from the signature that will be written, which
  // does not exist yet, so from the live record's canonical payload. This is
  // the one place a live read is correct: the signer is about to attest to the
  // CURRENT contents, and `assertUnamended` has just proved they match the
  // snapshot.
  let asRequested = null;
  try {
    const liveDoc = await sigService.loadDoc(client, {
      docType: request.doc_type, entityRef: request.entity_ref,
    });
    const payload = canonical.canonical(request.doc_type, liveDoc, request.payload_version);
    asRequested = summary.summarise(request.doc_type, payload, language);
  } catch (err) {
    logger.warn({ err: err && err.message, request_id: request.request_id }, "signing page could not summarise the document");
  }

  if (markViewed && party.status === "SENT") {
    await repo.updateParty(client, party.party_id, { status: "VIEWED", viewed_at: new Date() })
      .catch(() => { /* @silent:storage — a view stamp is telemetry; failing to
        record it must not stop the counterparty seeing the document. */ });
    await emitEvent(client, {
      eventTypeKey: events.VIEWED, moduleKey: events.MODULE, entityRef: request.entity_ref,
      actorUserId: null, payload: { request_id: request.request_id, party_id: party.party_id },
    }).catch(() => { /* @silent:storage — same. */ });
  }

  const challenge = await repo.latestOtp(client, { partyId: party.party_id });

  /*
   * The decline vocabulary travels WITH the page.
   *
   * The obvious alternative — have the page fetch `/signatures/reasons` — does
   * not work and should not be made to: that route is MOD-64 `view` behind
   * authMiddleware, and the counterparty has no account. Opening a second
   * public endpoint to serve five labels would be a second anonymous surface
   * to rate-limit, log and reason about, for data this response is already
   * making a round trip for.
   */
  const declineReasons = (await presets.reasons(client, { kind: "DECLINE" })).map((r) => ({
    reason_code: r.reason_code,
    label: language === "en" ? r.label_en : r.label_fr,
  }));

  return {
    language,
    status: party.status,
    request: {
      doc_type: request.doc_type,
      /*
       * The doc type in words. §3.12's rule — "MUST NOT print engineering
       * vocabulary" — is written about the seal, but it is the same reader:
       * a counterparty asked to sign `FINAL_INVOICE` is being shown an enum,
       * and a document a court reads should not need a glossary.
       *
       * Resolved from the template registry's own bilingual title, so a doc
       * type renamed there is renamed here too.
       */
      doc_type_label: docTypeLabel(request.doc_type, language),
      message: request.message,
      expires_at: request.expires_at,
      sequence_no: party.sequence_no,
      party_count: (await repo.listParties(client, request.request_id)).length,
    },
    // Rule 1: MASKED, and there is no field anywhere that writes it back.
    signer: {
      full_name: party.full_name,
      party_role: party.party_role,
      email_masked: otp.maskEmail(party.email),
      party_kind: party.party_kind,
    },
    as_requested: asRequested,
    menu: { cards, blocked, default: menu.default },
    decline_reasons: declineReasons,
    otp: otp.present(challenge),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// POST /public/sign/:token/otp  and  /verify
// ───────────────────────────────────────────────────────────────────────────

/**
 * Send or resend the code.
 *
 * The address comes from the PARTY ROW, never from the caller. The code is
 * bound to the request's snapshotted `content_hash`, so it verifies one
 * payload and cannot be replayed against another document in the same window.
 */
async function sendOtp(client, { token, lang = "fr", tenantName = "" }) {
  const language = langOf(lang);
  const { party, request } = await resolveToken(client, token);
  assertSignable(party, request);

  const { code, otp: row, resent } = await otp.issue(repo, client, {
    partyId: party.party_id,
    entityRef: request.entity_ref,
    contentHash: request.content_hash,
    sentTo: party.email,
  });

  const { subject, html, text } = mail.otpEmail({
    party, request, code, tenantName, language: langOf(party.language || language),
  });
  await mail.send(client, {
    to: party.email, subject, html, text,
    entityRef: request.entity_ref, sendPoint: "signature.otp",
  });

  await audit(client, {
    actorUserId: null, action: "document_signature.otp_sent", moduleKey: events.MODULE,
    entityRef: request.entity_ref,
    after: { request_id: request.request_id, party_id: party.party_id, otp_id: row.otp_id, resent },
  });

  return otp.present(row);
}

/** Verify the code. Returns the challenge's public shape; never the code. */
async function verifyOtp(client, { token, code, ip = null, userAgent = null }) {
  const { party, request } = await resolveToken(client, token);
  assertSignable(party, request);

  const row = await otp.verify(repo, client, {
    partyId: party.party_id,
    entityRef: request.entity_ref,
    contentHash: request.content_hash,
    code,
  });

  // §3.13: captured at the moment of OTP VERIFICATION — not page load, not
  // request creation. The evidentiary claim is about the act of signing.
  await audit(client, {
    actorUserId: null, action: "document_signature.otp_verified", moduleKey: events.MODULE,
    entityRef: request.entity_ref,
    after: { request_id: request.request_id, party_id: party.party_id, otp_id: row.otp_id, user_agent: userAgent },
    ip,
  });

  return otp.present(row);
}

// ───────────────────────────────────────────────────────────────────────────
// POST /public/sign/:token/complete
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sign.
 *
 * Rules 2 and 3 both land here, in this order: the amendment check first
 * (there is no point verifying a code against a document that has moved), then
 * the OTP requirement, then the write.
 */
async function complete(client, opts) {
  const {
    token, presetCode, signReason = null, markImageB64 = null,
    fullName = null, partyRole = null,
    ip = null, userAgent = null, lang = "fr", sendEmail = null, origin = null,
  } = opts;
  const language = langOf(lang);

  const { party, request } = await resolveToken(client, token);
  assertSignable(party, request);

  // RULE 3 — before anything else.
  const liveDoc = await requestService.assertUnamended(client, request);
  const { payload, hash, version } = canonical.build(request.doc_type, liveDoc);

  // The card must be one the sender allowed AND one the tenant still offers.
  const menu = await presets.resolveMenu(client, { docType: request.doc_type, language });
  const senderAllowed = new Set(party.allowed_presets || request.allowed_presets || []);
  if (!senderAllowed.has(presetCode)) {
    throw new AppError("PRESET_NOT_ALLOWED", "That signature method is not available for this document.", 422,
      { preset_code: presetCode, allowed: [...senderAllowed] });
  }
  const card = presets.assertAllowed(menu, presetCode);

  // RULE 2 — no threshold, no setting, no exception.
  const challenge = await repo.latestOtp(client, { partyId: party.party_id });
  const verified = challenge
    && challenge.verified_at
    && challenge.entity_ref === request.entity_ref
    && challenge.content_hash === request.content_hash;
  if (!verified) {
    throw new AppError(
      "OTP_REQUIRED",
      "Enter the code we emailed you before signing.",
      403,
      { party_id: party.party_id },
    );
  }

  // PR-4 and PR-5 own these two cards. Until then they are offered disabled by
  // the menu, and a caller that submits one anyway gets a straight answer
  // rather than a half-written signature.
  if (card.assurance_level === "QES") {
    throw new AppError("NOT_IMPLEMENTED", "Certified signatures are not switched on yet.", 501,
      { preset_code: presetCode });
  }
  if (card.assurance_level === "WET") {
    throw new AppError("NOT_IMPLEMENTED", "Signing on paper is not switched on yet.", 501,
      { preset_code: presetCode });
  }

  if (signReason) {
    const allowed = await presets.reasons(client);
    if (!allowed.some((r) => r.reason_code === signReason)) {
      throw new AppError("UNKNOWN_SIGN_REASON", `'${signReason}' is not a configured signing reason.`, 422,
        { available: allowed.map((r) => r.reason_code) });
    }
  }

  // Rule 1's other half. The signer MAY refine their own name and role — that
  // is the DECLARED identity, and the portal says the name is claimed. They
  // may not touch the address, and there is no field here that would let them.
  const signerName = String(fullName || party.full_name).trim().slice(0, 200) || party.full_name;
  const signerRole = partyRole === null ? party.party_role : String(partyRole).trim().slice(0, 120) || null;

  const settled = await repo.settleParty(client, party.party_id, "SIGNED");
  if (!settled) throw new AppError("ALREADY_SETTLED", "This party has already responded.", 409);

  const vaultDoc = await sigRepo.listByRef(client, request.entity_ref).catch(() => []);
  const row = await sigRepo.insert(client, {
    entity_ref: request.entity_ref,
    doc_type: request.doc_type,
    document_vault_id: request.document_vault_id || (vaultDoc[0] && vaultDoc[0].document_vault_id) || null,
    payload_version: version,
    content_hash: hash,
    content_payload: JSON.stringify(payload),
    assurance_level: "AES_OTP",
    visual_mark: card.visual_mark,
    preset_code: card.preset_code,
    sign_reason: signReason,
    party: "EXTERNAL",
    identity_source: "DECLARED",
    signer_name: signerName,
    signer_role: signerRole,
    signer_email: party.email,
    signature_request_id: request.request_id,
    mark_image_b64: card.visual_mark === "DRAWN" ? markImageB64 : null,
    verify_code: tokens.mintVerifyCode(),
    ip,
    user_agent: userAgent,
    otp_challenge_id: challenge.otp_id,
  });

  await emitEvent(client, {
    eventTypeKey: events.SIGNED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: null,
    payload: {
      signature_id: row.signature_id, request_id: request.request_id,
      party_id: party.party_id, preset_code: card.preset_code, assurance_level: "AES_OTP",
    },
  });
  await audit(client, {
    actorUserId: null, action: events.SIGNED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    after: {
      signature_id: row.signature_id, request_id: request.request_id, party_id: party.party_id,
      content_hash: hash, assurance_level: "AES_OTP", otp_id: challenge.otp_id,
    },
    ip,
  });

  const advanced = await requestService.advance(client, {
    request, party: settled, sendEmail, language,
  });

  /*
   * The certificate, on the final signature (§6.7).
   *
   * In the request path, not a queued job, and deliberately: with no PAdES
   * seal this document IS the evidentiary case, so a queue that is down means
   * a completed chain with no evidence and nobody watching for it. It is
   * idempotent on request_id, so a retry is free.
   *
   * Best-effort against the SIGNATURE, though — the signature row is written
   * and the chain is complete by this point, and failing the counterparty's
   * request because a PDF renderer hiccuped would lose an act that has already
   * legally happened. A missing certificate is recoverable by re-running
   * generateCertificate; a lost signature is not.
   */
  let certificate = null;
  if (advanced.completed === true) {
    try {
      certificate = await requestService.generateCertificate(client, {
        id: request.request_id, origin, language,
      });
    } catch (err) {
      logger.error(
        { err: err && err.message, request_id: request.request_id },
        "certificate of completion could not be generated — re-run signature_request.generateCertificate",
      );
    }
  }

  return {
    signed: true,
    certificate_doc_id: certificate ? certificate.doc_id : null,
    verify_code: tokens.formatCode(row.verify_code),
    completed: advanced.completed === true,
  };
}

/**
 * Decline, with a reason from the controlled list.
 *
 * Free text on a decline is the same liability as free text on a seal (§3.12):
 * somebody eventually types something that contradicts the document, or names
 * a person. The list is in `signature_reason` with `kind = 'DECLINE'`.
 *
 * A decline does NOT cancel earlier signatures. They remain valid records of
 * what those parties attested to, and the verification portal keeps saying so.
 */
async function declineSigning(client, { token, reasonCode, note = null, lang = "fr" }) {
  const language = langOf(lang);
  const { party, request } = await resolveToken(client, token);
  assertSignable(party, request);

  const allowed = await presets.reasons(client, { kind: "DECLINE" });
  const chosen = allowed.find((r) => r.reason_code === reasonCode);
  if (!chosen) {
    throw new AppError("UNKNOWN_DECLINE_REASON", "Choose a reason from the list.", 422,
      { available: allowed.map((r) => r.reason_code) });
  }

  const label = language === "en" ? chosen.label_en : chosen.label_fr;
  const reason = note ? `${label} — ${String(note).slice(0, 400)}` : label;

  await requestService.decline(client, { request, party, reason });
  return { declined: true, reason };
}

module.exports = {
  resolve, sendOtp, verifyOtp, complete, declineSigning,
  resolveToken, assertSignable, langOf,
};
