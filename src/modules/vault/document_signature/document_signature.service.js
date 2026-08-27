/**
 * Document signatures (MOD-64) — the choke point every signature passes
 * through. doc/SIGNATURE_ENGINEERING_GUIDE.md §4.5.
 *
 * ── The three rules a reviewer should reject a PR over ─────────────────────
 *
 * 1. IDENTITY IS RESOLVED, NEVER SUPPLIED. An internal signer's name and role
 *    come from `app_user` via the session. A request body carrying signer_name
 *    is REJECTED, not ignored — silently dropping it would let a caller believe
 *    it had been honoured, and "sign as the Managing Director by typing it into
 *    a form" is the exact attack this rule exists to stop.
 *
 * 2. assurance_level RECORDS EVIDENCE COLLECTED, never what was requested. The
 *    preset states a target; this service states the outcome.
 *
 * 3. A ROW IS NEVER DELETED OR OVERWRITTEN. Revocation sets a triple.
 *    Amendment changes nothing at all — it is derived on read.
 */
"use strict";

const repo = require("./document_signature.repo");
const vaultRepo = require("../document_vault/document_vault.repo");
const events = require("./document_signature.events");
const canonical = require("../../../services/signatures/canonical");
const tokens = require("../../../services/signatures/tokens");
const presets = require("../../../services/signatures/presets");
const { maskIp, coarseUserAgent } = require("../../../services/signatures/mask");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/** Plain-language assurance, for anything a non-engineer will read. */
const METHOD_WORDS = {
  SES:     { fr: "Signé depuis une session authentifiée", en: "Signed from an authenticated session" },
  AES_OTP: { fr: "Vérifié par code e-mail",               en: "Verified by email code" },
  QES:     { fr: "Certifié par un tiers de confiance",    en: "Certified by a trust provider" },
  WET:     { fr: "Signé à la main et rapproché",          en: "Signed by hand and reconciled" },
};
const methodWords = (level, lang) => (METHOD_WORDS[level] || METHOD_WORDS.SES)[lang === "en" ? "en" : "fr"];

/**
 * Resolve the live document in the shape canonical.js expects — the same shape
 * the template registry renders from, so the hash covers what is on the page.
 * Injectable so a caller that already holds the record does not re-fetch it.
 */
async function loadDoc(client, { docType, entityRef, doc = null }) {
  if (doc) return doc;
  const templateSvc = require("../../documents/template/template.service");
  // `loadRecord(client, docType, recordId)` — three positional arguments, and
  // the record id, not the entity ref. This called it as
  // `loadRecord(client, { docType, entityRef })` behind a
  // `typeof … === "function"` guard on a symbol the module did not export, so
  // the guard was always false and every caller landed on the throw below:
  // signing over HTTP returned 422 NO_DOCUMENT_LOADER, and every status read
  // degraded to UNKNOWN. Nothing failed loudly, because both callers treat a
  // failure to load as "cannot check" rather than as an error — which is the
  // right behaviour for a missing document and the wrong one for a wiring bug.
  const recordId = String(entityRef || "").split(":").slice(1).join(":");
  const rec = recordId ? await templateSvc.loadRecord(client, docType, recordId) : null;
  if (rec && rec.data) return rec.data;
  throw new AppError(
    "NO_DOCUMENT_LOADER",
    `Cannot load '${docType}' for signing. Pass the document explicitly, or add a loader to the template registry.`,
    422,
    { doc_type: docType, entity_ref: entityRef },
  );
}

/**
 * The live status of a stored signature. THIS is the staleness mechanism.
 *
 * `liveDoc` is null when the caller could not resolve the record — a deleted
 * or unloadable document reads UNKNOWN rather than AMENDED, because "we cannot
 * check" and "it changed" are different claims and only one of them accuses
 * somebody of something.
 */
function statusOf(sig, liveDoc) {
  if (sig.revoked_at) return "REVOKED";
  if (!liveDoc) return "UNKNOWN";
  let now;
  try {
    now = canonical.hash(sig.doc_type, liveDoc, sig.payload_version);
  } catch {
    return "UNKNOWN";
  }
  return now === sig.content_hash ? "VALID" : "AMENDED";
}

/**
 * Q5 = C: amendment is STALE AND LOUD. A signature that quietly stops counting
 * is worse than one that never existed, because nobody is told the document
 * they are relying on is no longer attested.
 *
 * Best-effort by design: this runs on a READ path, and a failure to raise the
 * flag must not stop the caller seeing that the document was amended. The
 * verdict is already computed; this is the alarm, not the finding.
 */
async function onAmendmentDetected(client, sig, liveDoc) {
  try {
    await repo.lockForAmendment(client, sig.signature_id);
    if (await repo.amendmentFlagExists(client, sig.entity_ref)) return;

    const changed = canonical.diff(sig.content_payload || {}, canonical.canonical(sig.doc_type, liveDoc, sig.payload_version));
    const fields = changed.map((c) => c.field).join(", ") || "unknown fields";
    await repo.raiseAmendmentFlag(client, {
      entityRef: sig.entity_ref,
      message: `${sig.doc_type} was signed by ${sig.signer_name} on ${new Date(sig.signed_at).toISOString().slice(0, 10)} and has changed since (${fields}). The signature no longer covers the current contents.`,
    });
    await emitEvent(client, {
      eventTypeKey: events.AMENDED, moduleKey: events.MODULE,
      entityRef: sig.entity_ref, actorUserId: null,
      payload: { signature_id: sig.signature_id, changed_fields: changed.map((c) => c.field) },
    });
    await audit(client, {
      actorUserId: null, action: events.STALE, moduleKey: events.MODULE, entityRef: sig.entity_ref,
      after: { signature_id: sig.signature_id, signed_hash: sig.content_hash, changed_fields: changed.map((c) => c.field) },
    });
  } catch (err) {
    logger.warn({ err: err && err.message, signature_id: sig.signature_id }, "amendment side effects failed");
  }
}

/** Shape a row for an authenticated caller. Full IP; the reveal is audited. */
/**
 * The tenant's own wording for a signing reason, by code.
 *
 * A Map, and read through `.get`: `sign_reason` originates in a request body,
 * and a plain object indexed by it answers `"constructor"` with a function —
 * the same shape that was a High CodeQL finding in canonical.js and is guarded
 * against in the client's `signature-vocab.look()`.
 */
async function reasonWordsMap(client, language) {
  try {
    const rows = await presets.reasons(client);
    return new Map(rows.map((r) => [r.reason_code, language === "en" ? r.label_en : r.label_fr]));
  } catch {
    /* @silent:parse — the reason vocabulary is a presentation lookup. A tenant
       whose settings table cannot be read still gets its signatures; the reason
       falls back to nothing rather than to a raw enum on a screen. */
    return new Map();
  }
}

/**
 * @param {Map<string,string>} [opts.reasonWords] resolved reason vocabulary.
 *   Passed in rather than looked up here because `present` is synchronous and
 *   is called once per row; one query per list, not one per signature.
 */
function present(sig, status, { language = "fr", full = false, reasonWords = null } = {}) {
  return {
    signature_id: sig.signature_id,
    entity_ref: sig.entity_ref,
    doc_type: sig.doc_type,
    status,
    party: sig.party,
    identity_source: sig.identity_source,
    signer_name: sig.signer_name,
    signer_role: sig.signer_role,
    signer_email: sig.signer_email,
    preset_code: sig.preset_code,
    assurance_level: sig.assurance_level,
    assurance_words: methodWords(sig.assurance_level, language),
    visual_mark: sig.visual_mark,
    sign_reason: sig.sign_reason,
    /*
     * The attestation IN WORDS, in the caller's language.
     *
     * The row stores a code, the seal prints the tenant's wording for it, and
     * until now the API returned only the code — so any screen showing the
     * reason showed `APPROVED_DISPATCH`. An enum must never reach a person
     * (client/src/features/vault/signature-vocab.ts opens with that rule);
     * the seal already obeyed it and the API did not.
     */
    sign_reason_words: (reasonWords && sig.sign_reason && reasonWords.get(sig.sign_reason)) || null,
    signed_at: sig.signed_at,
    verify_code: tokens.formatCode(sig.verify_code),
    content_hash: sig.content_hash,
    artifact_hash: sig.artifact_hash,
    document_vault_id: sig.document_vault_id,
    revoked_at: sig.revoked_at,
    revoke_reason: sig.revoke_reason,
    ip: full ? sig.ip : maskIp(sig.ip),
    device: coarseUserAgent(sig.user_agent, language),
    ...(full ? { content_payload: sig.content_payload, user_agent: sig.user_agent } : {}),
  };
}

/** Signatures on a document, each with its live status. */
async function listByRef(client, entityRef, { language = "fr", doc = null } = {}) {
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entity_ref is required", 422);
  const rows = await repo.listByRef(client, entityRef);
  if (!rows.length) return [];

  let liveDoc = doc;
  if (!liveDoc) {
    try {
      liveDoc = await loadDoc(client, { docType: rows[0].doc_type, entityRef });
    } catch {
      liveDoc = null; // → UNKNOWN, never a false accusation of amendment
    }
  }

  const reasonWords = await reasonWordsMap(client, language);
  const out = [];
  for (const sig of rows) {
    const status = statusOf(sig, liveDoc);
    if (status === "AMENDED") await onAmendmentDetected(client, sig, liveDoc);
    out.push(present(sig, status, { language, reasonWords }));
  }
  return out;
}

async function get(client, id, { language = "fr", full = false } = {}) {
  const sig = await repo.getById(client, id);
  if (!sig) throw new AppError("NOT_FOUND", "Signature not found", 404);
  let liveDoc = null;
  try {
    liveDoc = await loadDoc(client, { docType: sig.doc_type, entityRef: sig.entity_ref });
  } catch { /* @silent:parse — unloadable document reads UNKNOWN, not AMENDED */ }
  const status = statusOf(sig, liveDoc);
  if (status === "AMENDED") await onAmendmentDetected(client, sig, liveDoc);
  return present(sig, status, { language, full, reasonWords: await reasonWordsMap(client, language) });
}

/** The full card catalogue, for the settings screen. */
const presetCatalogue = (client) => presets.catalogue(client, { activeOnly: false });

/** The controlled signing-reason vocabulary (§3.12). Never free text. */
const reasons = (client) => presets.reasons(client);

/** The resolved card menu for a document (funnel levels 1–2). */
async function menu(client, { docType, language = "fr" }) {
  return presets.resolveMenu(client, { docType, language });
}

/**
 * Sign as the session user.
 *
 * `actor` is the resolved req.user. NOTHING about the signer comes from the
 * request body — see rule 1 in the file header. The validator rejects a body
 * carrying signer_name before this is reached.
 */
async function signInternal(client, opts) {
  const {
    entityRef, docType, presetCode, signReason = null,
    markImageB64 = null, actor = {}, ip = null, userAgent = null,
    language = "fr", doc = null, otpChallengeId = null,
  } = opts;

  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entity_ref is required", 422);
  if (!docType) throw new AppError("NO_DOC_TYPE", "doc_type is required", 422);
  if (!actor.user_id) throw new AppError("NO_ACTOR", "An authenticated user is required to sign", 401);

  const resolved = await presets.resolveMenu(client, { docType, language });
  const card = presets.assertAllowed(resolved, presetCode);

  if (signReason) {
    const allowed = await presets.reasons(client);
    if (!allowed.some((r) => r.reason_code === signReason)) {
      throw new AppError("UNKNOWN_SIGN_REASON", `'${signReason}' is not a configured signing reason.`, 422,
        { available: allowed.map((r) => r.reason_code) });
    }
  }

  const liveDoc = await loadDoc(client, { docType, entityRef, doc });
  const { payload, hash, version } = canonical.build(docType, liveDoc);

  // Identity, resolved server-side. A departure or a rename after this moment
  // must not rewrite a document that has already left the building, so these
  // are snapshots and not a join.
  const { rows: users } = await client.query(
    "SELECT user_id, full_name, job_title, email FROM app_user WHERE user_id = $1", [actor.user_id],
  );
  const user = users[0];
  if (!user) throw new AppError("NO_ACTOR", "Signing user not found", 401);

  /*
   * Rule 2, and §6.5's step-up.
   *
   * `assurance_level` records the evidence ACTUALLY collected, never what the
   * preset asked for (§1.3(b)). A session alone is SES. A cleared step-up
   * supplies `otpChallengeId` and lifts the SAME preset to AES_OTP — which is
   * the mechanism working as designed rather than an inconsistency.
   *
   * Above the threshold the step-up is REQUIRED, and this is where that is
   * enforced. Refusing here rather than in the controller means an AI action
   * or a future endpoint cannot route around it: the choke point every
   * signature passes through is the one that asks.
   */
  const stepUp = await stepUpNeeded(client, { docType, doc: liveDoc });
  if (stepUp && !otpChallengeId) {
    throw new AppError(
      "STEPUP_REQUIRED",
      "This document is above the amount that requires an emailed code as well as your password.",
      403,
      { doc_type: docType, entity_ref: entityRef },
    );
  }
  const assurance = otpChallengeId ? "AES_OTP" : "SES";

  const vaultDoc = await vaultRepo.getByRef(client, entityRef).catch(() => null);

  const row = await repo.insert(client, {
    entity_ref: entityRef,
    doc_type: docType,
    document_vault_id: vaultDoc ? vaultDoc.doc_id : null,
    payload_version: version,
    content_hash: hash,
    content_payload: JSON.stringify(payload),
    artifact_hash: vaultDoc ? vaultDoc.content_hash : null,
    assurance_level: assurance,
    visual_mark: card.visual_mark,
    preset_code: card.preset_code,
    sign_reason: signReason,
    party: "INTERNAL",
    identity_source: "SESSION",
    signer_user_id: user.user_id,
    signer_name: user.full_name,
    signer_role: user.job_title || null,
    signer_email: user.email || null,
    mark_image_b64: card.visual_mark === "DRAWN" ? markImageB64 : null,
    verify_code: tokens.mintVerifyCode(),
    ip,
    user_agent: userAgent,
    otp_challenge_id: otpChallengeId,
  });

  await emitEvent(client, {
    eventTypeKey: events.SIGNED, moduleKey: events.MODULE, entityRef, actorUserId: user.user_id,
    payload: { signature_id: row.signature_id, doc_type: docType, preset_code: card.preset_code, assurance_level: assurance },
  });
  await audit(client, {
    actorUserId: user.user_id, action: events.SIGNED, moduleKey: events.MODULE, entityRef,
    after: {
      signature_id: row.signature_id, content_hash: hash, assurance_level: assurance,
      visual_mark: card.visual_mark, preset_code: card.preset_code,
    },
    ip,
  });

  return present(row, "VALID", { language });
}

/**
 * Revoke. The row survives: the public portal must keep answering "revoked" for
 * anyone holding a PDF printed before this moment, rather than 404 — otherwise
 * the holder can claim the link is merely broken.
 */
async function revoke(client, { id, reason, actor = {}, ip = null, language = "fr" }) {
  if (!reason || !String(reason).trim()) {
    throw new AppError("NO_REASON", "A revocation reason is required", 422);
  }
  const before = await repo.getById(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Signature not found", 404);
  if (before.revoked_at) throw new AppError("ALREADY_REVOKED", "This signature is already revoked", 409);

  const row = await repo.revoke(client, { id, actorUserId: actor.user_id || null, reason: String(reason).trim() });
  if (!row) throw new AppError("ALREADY_REVOKED", "This signature is already revoked", 409);

  await emitEvent(client, {
    eventTypeKey: events.REVOKED, moduleKey: events.MODULE, entityRef: row.entity_ref,
    actorUserId: actor.user_id || null, payload: { signature_id: id, reason: row.revoke_reason },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.REVOKED, moduleKey: events.MODULE,
    entityRef: row.entity_ref, before: { revoked_at: null }, after: { revoked_at: row.revoked_at, reason: row.revoke_reason }, ip,
  });
  return present(row, "REVOKED", { language });
}

/** Written back after the document is rendered and vaulted (PR-2 calls this). */
const setArtifact = (client, args) => repo.setArtifact(client, args);

/**
 * Who verified this signature, when, and from how many distinct addresses.
 *
 * This is what replaced the deleted "paste a hash" screen (§5.7, addition i).
 * That screen asked an operator to type a fingerprint into a box and told them
 * whether it matched — a mechanism this programme removes, and one that never
 * answered a question anybody actually had. The question they DO have is this
 * one: has anyone checked the document I sent out, and from where?
 *
 * IPs are masked here as well as on the portal. §3.13 grants the full value to
 * MOD-64 `view`, but as a DELIBERATE reveal that is itself audited — a list
 * that renders forty full addresses by default is not that reveal, it is a
 * standing disclosure nobody asked for.
 */
async function scans(client, signatureId, { language = "fr" } = {}) {
  const sig = await repo.getById(client, signatureId);
  if (!sig) throw new AppError("NOT_FOUND", "Signature not found", 404);
  const [rows, totals] = await Promise.all([
    repo.listScans(client, signatureId),
    repo.scanSummary(client, signatureId),
  ]);
  return {
    ...totals,
    scans: rows.map((r) => ({
      scan_id: r.scan_id,
      scanned_at: r.scanned_at,
      via: r.via,
      is_new_ip: r.is_new_ip,
      ip: maskIp(r.ip),
      device: coarseUserAgent(r.user_agent, language),
    })),
  };
}

/**
 * Retention sweep for `signature_scan` (§5.4). `ip` is personal data and
 * `signature_policy.scan_retention_days` (default 400) is the tenant's answer
 * for how long it may be held; the portal's privacy notice states that it is
 * held at all. The immutable_ledger copy is governed by its own rules and is
 * NOT touched.
 *
 * Returns the row count so a run that deleted nothing is distinguishable from
 * one that never ran.
 */
async function pruneScans(client) {
  const days = Number(await getSetting(client, "signature_policy", "scan_retention_days", 400));
  if (!Number.isFinite(days) || days <= 0) return 0;
  return repo.pruneScans(client, days);
}

const stats = (client) => repo.stats(client);

/**
 * Is the internal step-up OTP required for this document? (Q9 = C, §6.5.)
 *
 * The total is DERIVED from the document rather than passed in. PR-1's version
 * took a `totalXaf` argument, which meant every caller had to compute the same
 * figure the same way — and a caller that computed it wrong, or passed zero,
 * silently skipped the control. Reading it from the canonical payload means it
 * is the same number the signature attests to.
 *
 * Default OFF, per §1.5(b): a dispatcher signing forty delivery notes a day
 * would do forty OTP round-trips, and a control that painful gets switched off
 * — which is how the predecessor system lost its OTP. Setting the threshold to
 * zero makes the product universal-OTP with no other change.
 */
async function stepUpNeeded(client, { docType, doc }) {
  const enabled = await getSetting(client, "signature_policy", "stepup_enabled", false);
  if (enabled !== true) return false;
  const threshold = await getSetting(client, "signature_policy", "stepup_threshold_xaf", null);
  if (threshold === null || threshold === undefined) return false;
  const total = documentTotalXaf(docType, doc);
  return total !== null && total >= Number(threshold);
}

/**
 * The figure the threshold compares against, read off the canonical payload.
 *
 * A doc type with no money on its face — a delivery note, a transit order —
 * returns null and never steps up. That is correct rather than a gap: the
 * threshold is about value at risk, and a waybill carries none.
 */
function documentTotalXaf(docType, doc) {
  try {
    const payload = canonical.canonical(docType, doc);
    if (payload.totals && Number.isFinite(Number(payload.totals.total_ttc))) {
      return Number(payload.totals.total_ttc);
    }
    if (Number.isFinite(Number(payload.gross_salary))) return Number(payload.gross_salary);
  } catch {
    /* @silent:parse — a doc type with no canonical builder cannot be signed at
       all; signInternal rejects it with NO_CANONICAL_PAYLOAD before the
       threshold could matter. */
  }
  return null;
}

/** Back-compat for callers that already hold a total. Prefer stepUpNeeded. */
async function stepUpRequired(client, { totalXaf }) {
  const enabled = await getSetting(client, "signature_policy", "stepup_enabled", false);
  if (enabled !== true) return false;
  const threshold = await getSetting(client, "signature_policy", "stepup_threshold_xaf", null);
  if (threshold === null || threshold === undefined) return false;
  return Number(totalXaf || 0) >= Number(threshold);
}

module.exports = {
  listByRef, get, menu, reasons, signInternal, revoke, setArtifact, stats,
  scans, pruneScans,
  presets: presetCatalogue,
  // Exported for the public portal, which detects the same amendment from the
  // other side of the wall and must raise the same flag. One detector, two
  // entry points — two would drift.
  statusOf, present, methodWords, stepUpRequired, stepUpNeeded, documentTotalXaf, loadDoc, onAmendmentDetected,
};
