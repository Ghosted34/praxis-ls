/**
 * Signature requests (MOD-64) — the chain.
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR RULES A REVIEWER SHOULD REJECT A PR OVER
 *
 * 1. THE PAYLOAD IS SNAPSHOTTED, AND EVERY SIGNING ACT RE-COMPARES (§1.3(a)).
 *    Party A signs an invoice for 1 607 900. Somebody edits a line. Party B
 *    must NOT be able to countersign 1 812 400 while believing they agreed to
 *    what A did. On mismatch: 409 DOCUMENT_AMENDED, the request moves to
 *    AMENDED, every pending party is barred, every signed party is notified,
 *    and a compliance flag is raised. Reissuing mints a NEW request — a
 *    reopened one is indistinguishable from "the figures moved while nobody
 *    was looking".
 *
 * 2. THE ISSUER SIGNS BEFORE DISPATCH, NOT AFTER (§6.6). `dispatch` refuses
 *    with 409 ISSUER_NOT_SIGNED while an ISSUER party at sequence 1 is still
 *    pending. A counterparty must never receive a link to countersign a
 *    document the issuing company has not signed — that is how a document goes
 *    out attested by nobody.
 *
 * 3. A SIGNER NEVER SUPPLIES AN ADDRESS (§6.3, Q7 = C is forbidden). There is
 *    no code path here that takes an email from a signing-page body. A signer
 *    states their NAME and ROLE; the address was put on file by the tenant, or
 *    typed by a tenant user who is named in the record.
 *
 * 4. AT MOST ONE OVERRIDE PER REQUEST, AND THE DATABASE IS WHAT SAYS SO. The
 *    validator gives the friendly error; `uq_sigparty_one_override` is what
 *    makes the rule true when a future import path forgets to ask.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const repo = require("./signature_request.repo");
const events = require("./signature_request.events");
const sigRepo = require("../document_signature/document_signature.repo");
const sigService = require("../document_signature/document_signature.service");
const canonical = require("../../../services/signatures/canonical");
const tokens = require("../../../services/signatures/tokens");
const presets = require("../../../services/signatures/presets");
const otpService = require("../../../services/signatures/otp");
const { signaturePolicyFor } = require("../document_vault/document_vault.types");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const certificate = require("../../../services/signatures/certificate");
const verifyLink = require("../../../services/signatures/verify-link");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/** How long a signing link lives when the sender does not say. */
const DEFAULT_EXPIRY_DAYS = 14;

const lang = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

// ───────────────────────────────────────────────────────────────────────────
// Funnel level 3 — the sender's two booleans (§1.5(a), Q16)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve what the sender may narrow the tenant menu to.
 *
 * The sender gets TWO BOOLEANS, not a menu. §1.5(a): every digital card is
 * AES_OTP, so STAMP and DRAWN differ in APPEARANCE and never in legal weight —
 * a sender picking between them is choosing a look on the signer's behalf,
 * which is precisely the choice the signer was meant to make. The only sender
 * decisions that change the EVIDENCE are whether third-party certification is
 * required and whether paper is acceptable.
 *
 * Stored RESOLVED rather than as the booleans: the booleans are an input, and
 * storing an input means re-deriving the answer at every read against a tenant
 * menu that may have changed underneath it.
 */
async function resolveAllowedPresets(client, { docType, requireCertified = false, allowPaper = true, language = "fr" }) {
  const menu = await presets.resolveMenu(client, { docType, language });
  let codes = menu.cards.map((c) => c.preset_code);

  if (requireCertified) {
    codes = codes.filter((c) => c === "CERTIFIED");
    if (!codes.length) {
      throw new AppError(
        "CERTIFIED_NOT_AVAILABLE",
        "A certified signature was required, but it is not available for this document type or is not switched on.",
        422,
        { doc_type: docType },
      );
    }
  }
  if (!allowPaper) codes = codes.filter((c) => c !== "PRINT_SIGN");

  if (!codes.length) {
    throw new AppError(
      "EMPTY_SIGNATURE_MENU",
      "No signature method is available for this document with the options chosen.",
      422,
      { doc_type: docType },
    );
  }
  return codes;
}

// ───────────────────────────────────────────────────────────────────────────
// Creating a request
// ───────────────────────────────────────────────────────────────────────────

/**
 * Create a chain over a document.
 *
 * `parties` arrive ordered. Each is either ON_FILE — pulled from the tenant's
 * own records, carrying a source_ref naming the row — or the ONE override,
 * which must name the user who authorised it and why.
 */
async function create(client, opts) {
  const {
    entityRef, docType, parties = [], message = null,
    requireCertified = false, allowPaper = true, expiresInDays = DEFAULT_EXPIRY_DAYS,
    actor = {}, doc = null, language = "fr",
  } = opts;

  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entity_ref is required", 422);
  if (!docType) throw new AppError("NO_DOC_TYPE", "doc_type is required", 422);
  if (!actor.user_id) throw new AppError("NO_ACTOR", "An authenticated user is required", 401);
  if (!parties.length) throw new AppError("NO_PARTIES", "A signature request needs at least one signatory", 422);

  const ceiling = signaturePolicyFor(docType);
  if (!ceiling.signable) {
    throw new AppError("NOT_SIGNABLE", `'${docType}' cannot be signed.`, 422, { doc_type: docType });
  }

  // Rule 1's snapshot. Taken from the SAME shape the templates render from, so
  // the hash covers what is on the page a person will sign.
  const liveDoc = await sigService.loadDoc(client, { docType, entityRef, doc });
  const { hash, version } = canonical.build(docType, liveDoc);

  const allowedPresets = await resolveAllowedPresets(client, {
    docType, requireCertified, allowPaper, language,
  });

  // The friendly half of rule 4. `uq_sigparty_one_override` is the half that
  // is true whatever calls this.
  const overrides = parties.filter((p) => p.source === "OVERRIDE");
  if (overrides.length > 1) {
    throw new AppError(
      "TOO_MANY_OVERRIDES",
      "Only one signatory may be entered by hand. Everyone else must come from your records.",
      422,
      { count: overrides.length },
    );
  }

  /*
   * `created_by` is REFERENCES app_user(user_id), and identity lives in the
   * LIVE schema. A request created in SANDBOX would otherwise raise 23503 for
   * a user who is perfectly real — the row just is not in that schema. DATA 2.4,
   * and scripts/check-actor-fk-guard.js is the gate.
   *
   * Degrading to NULL is not an option here: `created_by` is NOT NULL, because
   * a signing chain nobody created is not a record anyone can act on. So the
   * resolution is asserted instead, and a sandbox that cannot see the user
   * fails with a sentence rather than a constraint name.
   */
  const createdBy = await resolveActorId(client, actor.user_id);
  if (!createdBy) {
    throw new AppError(
      "NO_ACTOR",
      "The signing user could not be resolved in this environment.",
      401,
      { user_id: actor.user_id },
    );
  }

  const request = await repo.insertRequest(client, {
    entity_ref: entityRef,
    doc_type: docType,
    payload_version: version,
    content_hash: hash,
    allowed_presets: allowedPresets,
    status: "DRAFT",
    message,
    expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    created_by: createdBy,
  });

  let seq = 0;
  for (const p of parties) {
    seq += 1;
    await repo.insertParty(client, {
      request_id: request.request_id,
      sequence_no: seq,
      party_kind: p.party_kind,
      source: p.source,
      source_ref: p.source === "ON_FILE" ? p.source_ref || null : null,
      // Rule 3's other half: an override is ATTRIBUTED. The certificate prints
      // who stood behind the address and why, so a reader can weigh it.
      override_by_user_id: p.source === "OVERRIDE" ? actor.user_id : null,
      override_reason: p.source === "OVERRIDE" ? p.override_reason : null,
      full_name: p.full_name,
      party_role: p.party_role || null,
      email: p.email,
      language: p.language || null,
      allowed_presets: allowedPresets,
      status: "PENDING",
    });
  }

  await emitEvent(client, {
    eventTypeKey: events.REQUESTED, moduleKey: events.MODULE, entityRef,
    actorUserId: actor.user_id,
    payload: { request_id: request.request_id, doc_type: docType, parties: seq },
  });
  await audit(client, {
    actorUserId: actor.user_id, action: events.REQUESTED, moduleKey: events.MODULE, entityRef,
    after: { request_id: request.request_id, content_hash: hash, allowed_presets: allowedPresets, parties: seq },
  });

  return get(client, request.request_id, { language });
}

// ───────────────────────────────────────────────────────────────────────────
// Reading
// ───────────────────────────────────────────────────────────────────────────

/** A party, as a tenant user may see it. The token never appears. */
function presentParty(p, language) {
  return {
    party_id: p.party_id,
    sequence_no: p.sequence_no,
    party_kind: p.party_kind,
    source: p.source,
    // §6.3: the reader gets to weigh an override; the system does not pretend
    // the two kinds of address are identical.
    source_words: p.source === "ON_FILE"
      ? (language === "en" ? "Address on file" : "Adresse au dossier")
      : (language === "en" ? "Address entered by a colleague" : "Adresse saisie par un collègue"),
    override_reason: p.override_reason || null,
    full_name: p.full_name,
    party_role: p.party_role,
    email: p.email,
    status: p.status,
    decline_reason: p.decline_reason || null,
    sent_at: p.sent_at,
    viewed_at: p.viewed_at,
    settled_at: p.settled_at,
  };
}

async function get(client, id, { language = "fr" } = {}) {
  const request = await repo.getRequest(client, id);
  if (!request) throw new AppError("NOT_FOUND", "Signature request not found", 404);
  const parties = await repo.listParties(client, id);
  return {
    ...request,
    parties: parties.map((p) => presentParty(p, lang(language))),
    signed_count: parties.filter((p) => p.status === "SIGNED").length,
    party_count: parties.length,
  };
}

const list = (client, filters) => repo.listRequests(client, filters || {});

// ───────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────

/**
 * Send the next party their link.
 *
 * Rule 2 lives here. An ISSUER at sequence 1 signs through the INTERNAL path
 * (`POST /signatures/internal`) — they are already authenticated, and emailing
 * them a token would be theatre — so `dispatch` refuses while that party is
 * still pending.
 */
async function dispatch(client, { id, actor = {}, language = "fr", sendEmail = null }) {
  await repo.lockRequest(client, id);
  const request = await repo.getRequest(client, id);
  if (!request) throw new AppError("NOT_FOUND", "Signature request not found", 404);
  if (!["DRAFT", "SENT", "PARTIALLY_SIGNED"].includes(request.status)) {
    throw new AppError("NOT_DISPATCHABLE", `A ${request.status} request cannot be dispatched.`, 409,
      { status: request.status });
  }

  const parties = await repo.listParties(client, id);
  const issuer = parties.find((p) => p.party_kind === "ISSUER" && p.sequence_no === 1);
  if (issuer && issuer.status !== "SIGNED") {
    throw new AppError(
      "ISSUER_NOT_SIGNED",
      "The issuing company has not signed yet. Sign it internally before sending it to the counterparty.",
      409,
      { party_id: issuer.party_id },
    );
  }

  const next = parties.find((p) => p.status === "PENDING");
  if (!next) throw new AppError("NOTHING_TO_DISPATCH", "Every party has already been sent their link.", 409);

  // A DIFFERENT secret from the verify code, minted here and emailed once.
  // §3.7: a leaked verify code shows somebody a summary the tenant chose to
  // publish; a leaked sign token IS a forged signature.
  const { token, hmac } = tokens.mintSignToken();
  const party = await repo.updateParty(client, next.party_id, {
    sign_token_hmac: hmac,
    sign_expires_at: request.expires_at || new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000),
    status: "SENT",
    sent_at: new Date(),
  });

  if (request.status === "DRAFT") {
    await repo.transitionRequest(client, id, "SENT", ["DRAFT"]);
  }

  await emitEvent(client, {
    eventTypeKey: events.DISPATCHED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: actor.user_id || null,
    payload: { request_id: id, party_id: party.party_id, sequence_no: party.sequence_no },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.DISPATCHED, moduleKey: events.MODULE,
    entityRef: request.entity_ref,
    after: { request_id: id, party_id: party.party_id, sent_to: party.email },
  });

  // The caller supplies the mailer so this stays testable without a transport.
  if (typeof sendEmail === "function") {
    await sendEmail({ party, request, token, language: lang(party.language || language) });
  }

  // The plaintext token is returned ONCE, for the caller to put in a link. It
  // is never stored and cannot be recovered.
  return { party: presentParty(party, lang(language)), token };
}

// ───────────────────────────────────────────────────────────────────────────
// The amendment guard — rule 1
// ───────────────────────────────────────────────────────────────────────────

/**
 * Re-derive the canonical hash and compare it to the snapshot.
 *
 * Returns the live document on a match. On a mismatch it does the whole
 * §1.3(a) transition — bar the chain, notify who has already signed, raise the
 * flag — and then throws 409 DOCUMENT_AMENDED.
 */
async function assertUnamended(client, request, { doc = null } = {}) {
  let liveDoc = null;
  try {
    liveDoc = await sigService.loadDoc(client, {
      docType: request.doc_type, entityRef: request.entity_ref, doc,
    });
  } catch {
    /* @silent:parse — an unloadable record cannot be compared. It is handled
       below as a refusal to sign rather than as an amendment: "we cannot
       check" and "it changed" are different claims, and only one of them
       accuses somebody of something. */
  }
  if (!liveDoc) {
    throw new AppError(
      "DOCUMENT_UNREADABLE",
      "The document behind this request could not be read, so it cannot be signed right now.",
      409,
    );
  }

  const now = canonical.hash(request.doc_type, liveDoc, request.payload_version);
  if (now === request.content_hash) return liveDoc;

  await onAmendment(client, request, liveDoc, now);
  throw new AppError(
    "DOCUMENT_AMENDED",
    "This document changed after the signature request was created. It has to be reissued.",
    409,
    { request_id: request.request_id },
  );
}

/**
 * The amendment transition. Best-effort in its side effects, definite in its
 * state change: the request MUST leave the signable set even if the
 * notifications fail.
 */
async function onAmendment(client, request, liveDoc, currentHash) {
  await repo.transitionRequest(client, request.request_id, "AMENDED",
    ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);

  try {
    const changed = canonical.diff(
      // The stored payload lives on the SIGNATURES, not on the request — the
      // request stores only the hash. Any signed party's payload is the one
      // that was agreed, so the first is as good as any.
      (await sigRepo.listByRef(client, request.entity_ref))[0]?.content_payload || {},
      canonical.canonical(request.doc_type, liveDoc, request.payload_version),
    );
    const fields = changed.map((c) => c.field).join(", ") || "unknown fields";

    if (!(await sigRepo.amendmentFlagExists(client, request.entity_ref))) {
      await sigRepo.raiseAmendmentFlag(client, {
        entityRef: request.entity_ref,
        message: `${request.doc_type} changed while a signature chain was open (${fields}). The chain has been stopped and must be reissued.`,
      });
    }

    await emitEvent(client, {
      eventTypeKey: events.AMENDED, moduleKey: events.MODULE, entityRef: request.entity_ref,
      actorUserId: null, priority: "HIGH",
      payload: {
        request_id: request.request_id,
        signed_hash: request.content_hash,
        current_hash: currentHash,
        changed_fields: changed.map((c) => c.field),
      },
    });
    await audit(client, {
      actorUserId: null, action: events.AMENDED, moduleKey: events.MODULE,
      entityRef: request.entity_ref,
      before: { content_hash: request.content_hash },
      after: { content_hash: currentHash, request_id: request.request_id },
    });
  } catch (err) {
    // The request is already out of the signable set by this point, which is
    // the part that must not fail. This is the alarm, not the finding.
    logger.warn({ err: err && err.message, request_id: request.request_id }, "amendment side effects failed");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Chain advance
// ───────────────────────────────────────────────────────────────────────────

/**
 * Settle a party as SIGNED and move the chain on, in the caller's transaction.
 *
 * Either dispatches the next sequence or completes the request. The advisory
 * lock is what stops two simultaneous completions each enqueuing a
 * certificate.
 */
async function advance(client, { request, party, actor = {}, sendEmail = null, language = "fr" }) {
  await repo.lockRequest(client, request.request_id);

  const remaining = await repo.nextPendingParty(client, request.request_id);
  if (remaining) {
    await repo.transitionRequest(client, request.request_id, "PARTIALLY_SIGNED",
      ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
    // The next link goes out only for a party who has not been sent one; an
    // ISSUER at sequence 1 is handled by the internal path.
    if (remaining.status === "PENDING" && remaining.party_kind !== "ISSUER") {
      await dispatch(client, { id: request.request_id, actor, language, sendEmail });
    }
    return { completed: false, next_party_id: remaining.party_id };
  }

  const completed = await repo.transitionRequest(
    client, request.request_id, "COMPLETED",
    ["DRAFT", "SENT", "PARTIALLY_SIGNED"], { completed_at: new Date() },
  );
  // No row means another transaction completed it first. Not an error — the
  // chain is complete either way, and the certificate is idempotent.
  if (!completed) return { completed: true, already: true };

  await emitEvent(client, {
    eventTypeKey: events.COMPLETED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: actor.user_id || null,
    payload: { request_id: request.request_id, party_id: party ? party.party_id : null },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.COMPLETED, moduleKey: events.MODULE,
    entityRef: request.entity_ref, after: { request_id: request.request_id },
  });
  return { completed: true };
}

/**
 * Decline, with a reason.
 *
 * A decline does NOT silently cancel the earlier signatures: they remain valid
 * records of what those parties attested to, and the portal keeps reporting
 * them as such. What it stops is the chain.
 */
async function decline(client, { request, party, reason, actor = {} }) {
  if (!reason) throw new AppError("NO_REASON", "A reason is required to decline.", 422);

  const settled = await repo.settleParty(client, party.party_id, "DECLINED", { decline_reason: reason });
  if (!settled) throw new AppError("ALREADY_SETTLED", "This party has already responded.", 409);

  await repo.transitionRequest(client, request.request_id, "DECLINED",
    ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);

  await emitEvent(client, {
    eventTypeKey: events.DECLINED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: actor.user_id || null, priority: "HIGH",
    payload: { request_id: request.request_id, party_id: party.party_id, reason },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.DECLINED, moduleKey: events.MODULE,
    entityRef: request.entity_ref,
    after: { request_id: request.request_id, party_id: party.party_id, reason },
  });
  return settled;
}

/**
 * Void a request the sender no longer wants. Signatures already taken survive.
 *
 * In-flight certified envelopes are cancelled with the request (guide §7.4
 * step 7): the provider's document and its signable link go, and the ledger
 * row stays — non-refundable once issued, because the provider consumed the
 * quota whatever we do. Best-effort on purpose: a provider that will not take
 * the cancel must not hold the void hostage, and the poll backstop reports
 * whatever mismatch remains.
 *
 * Lazy require: the qes service requires THIS service (the chain advance it
 * triggers goes through here), and a top-level cycle would leave one side's
 * exports undefined at load time — the same load-order trap the certificate
 * renderer below already avoids.
 */
async function voidRequest(client, { id, reason = null, actor = {} }) {
  const request = await repo.getRequest(client, id);
  if (!request) throw new AppError("NOT_FOUND", "Signature request not found", 404);
  const voided = await repo.transitionRequest(client, id, "VOIDED",
    ["DRAFT", "SENT", "PARTIALLY_SIGNED", "AMENDED"]);
  if (!voided) {
    throw new AppError("NOT_VOIDABLE", `A ${request.status} request cannot be voided.`, 409,
      { status: request.status });
  }

  try {
    const qesService = require("../qes/qes.service");
    await qesService.cancelForRequest(client, { requestId: id, actor });
  } catch (err) {
    // The void already happened; the envelopes are the alarm, not the finding.
    logger.warn({ err: err && err.message, request_id: id }, "could not cancel QES envelopes on void");
  }

  await audit(client, {
    actorUserId: actor.user_id || null, action: "document_signature.voided", moduleKey: events.MODULE,
    entityRef: request.entity_ref, after: { request_id: id, reason },
  });
  return voided;
}

// ───────────────────────────────────────────────────────────────────────────
// The Certificate of Completion (§6.7)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Generate the certificate for a completed chain — ONCE.
 *
 * ⚠ IDEMPOTENT ON `request_id`, AND THAT IS NOT AN OPTIMISATION.
 *
 * A regenerated certificate produces different bytes (Puppeteer stamps
 * /CreationDate) and therefore a different artifact hash, so two "copies" of
 * one certificate would disagree about their own fingerprint — and a reader
 * comparing them would be right to conclude one had been tampered with. The
 * existing vault row is returned instead.
 *
 * The advisory lock is what makes that true under concurrency: the final
 * party's `/complete` and a retried job can arrive together, and without it
 * both would see `certificate_doc_id IS NULL`.
 */
async function generateCertificate(client, { id, origin = null, language = "fr" }) {
  await repo.lockRequest(client, id);

  const request = await repo.getRequest(client, id);
  if (!request) throw new AppError("NOT_FOUND", "Signature request not found", 404);
  if (request.certificate_doc_id) {
    return { doc_id: request.certificate_doc_id, already: true };
  }
  if (request.status !== "COMPLETED") {
    throw new AppError(
      "NOT_COMPLETED",
      "A certificate is issued when every party has signed.",
      409,
      { status: request.status },
    );
  }

  const [parties, signatures, otps, ledger] = await Promise.all([
    repo.listParties(client, id),
    sigRepo.listByRef(client, request.entity_ref),
    repo.otpsForRequest(client, id),
    repo.ledgerForRequest(client, request.entity_ref),
  ]);

  const templateSvc = require("../../documents/template/template.service");
  const entity = await entityForCertificate(client);
  const baseUrl = await verifyLink.baseUrl(client, { origin });

  const data = await certificate.build(client, {
    request, parties, signatures, otps, ledger, entity, language, baseUrl,
  });

  // Rendered through the SAME pipeline as every other document, so it is
  // captured, hashed and downloadable like one. An evidence document outside
  // the vault would be the only document here with no trail of its own.
  const out = await templateSvc.renderPdfFromData(client, {
    docType: "SIGNATURE_CERTIFICATE", data, entityId: null, actor: {},
  });

  await repo.updateRequest(client, id, { certificate_doc_id: out.doc_id });

  await emitEvent(client, {
    eventTypeKey: events.CERTIFICATE_ISSUED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: null,
    payload: { request_id: id, doc_id: out.doc_id, artifact_hash: out.content_hash },
  });
  await audit(client, {
    actorUserId: null, action: events.CERTIFICATE_ISSUED, moduleKey: events.MODULE,
    entityRef: request.entity_ref,
    after: { request_id: id, doc_id: out.doc_id, artifact_hash: out.content_hash },
  });

  return { doc_id: out.doc_id, artifact_hash: out.content_hash, already: false };
}

/** The tenant's own legal block, for §6.7 item 7. */
async function entityForCertificate(client) {
  const { rows } = await client.query(
    "SELECT legal_name, rccm, niu, address FROM corporate_entity ORDER BY created_at LIMIT 1",
  );
  return rows[0] || null;
}

// ───────────────────────────────────────────────────────────────────────────
// Reminders (§6.8)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Who is owed a nudge right now.
 *
 * Two per request, then silence — *"a third email teaches people to filter
 * you"*. The schedule is a setting (`reminder_days`, default `[2, 5]`) and an
 * empty array disables it, so a tenant that finds it intrusive turns it off
 * rather than asking us to.
 */
async function dueReminders(client) {
  const days = await getSetting(client, "signature_policy", "reminder_days", [2, 5]);
  if (!Array.isArray(days) || !days.length) return [];

  const seen = new Set();
  const out = [];
  // Ascending, so a party overdue on BOTH thresholds is nudged once for the
  // earlier one rather than twice in the same sweep.
  for (const d of [...days].map(Number).filter(Number.isFinite).sort((a, b) => a - b)) {
    // eslint-disable-next-line no-await-in-loop -- one query per threshold, and
    // there are two; running them concurrently would let the same party match
    // both before `seen` could exclude it.
    for (const row of await repo.partiesDueReminder(client, d)) {
      if (seen.has(row.party_id)) continue;
      seen.add(row.party_id);
      out.push(row);
    }
  }
  return out;
}

/**
 * Re-mint the signing token for a party who is being nudged.
 *
 * ── A decision the guide left open, and why it lands here ──────────────────
 * §6.8 says to remind a party after two days and again at five. It does not
 * say what LINK the reminder carries, and there are only three answers:
 *
 *   1. Re-send the original token. Impossible, and deliberately so: the
 *      plaintext is emailed once and never stored (§3.7) — only its HMAC is.
 *      Storing it to make reminders convenient would undo the reason the sign
 *      token is peppered while the verify code is not.
 *   2. Send no link, just a nudge. Honest, and bad: the counterparty then has
 *      to find a five-day-old email, which is most of why they had not signed.
 *   3. Mint a fresh token and say so. This.
 *
 * Rotation is also the better security answer. A signing credential that has
 * been sitting in an inbox for five days is exactly the one worth replacing,
 * and the old link stops working the moment this runs — which is what the
 * reminder email tells the reader, plainly, so a signer who still has the
 * first message is not left wondering why it 404s.
 *
 * Returns null for a party who has settled since the sweep selected them.
 */
async function remintSignToken(client, { partyId, expiresAt }) {
  const party = await repo.getParty(client, partyId);
  if (!party || !["SENT", "VIEWED"].includes(party.status)) return null;
  const { token, hmac } = tokens.mintSignToken();
  const updated = await repo.updateParty(client, partyId, {
    sign_token_hmac: hmac,
    sign_expires_at: expiresAt || party.sign_expires_at,
  });
  return { token, party: updated };
}

/** Record that a nudge went out. The cap lives on the request, not the party. */
async function recordReminder(client, { requestId, partyId, entityRef }) {
  const { rows } = await client.query(
    `UPDATE signature_request
        SET reminder_count = LEAST(reminder_count + 1, 2), last_reminder_at = now()
      WHERE request_id = $1 AND reminder_count < 2
      RETURNING request_id, reminder_count`,
    [requestId],
  );
  if (!rows[0]) return null;
  await emitEvent(client, {
    eventTypeKey: events.REMINDED, moduleKey: events.MODULE, entityRef,
    actorUserId: null, payload: { request_id: requestId, party_id: partyId, nudge: rows[0].reminder_count },
  });
  return rows[0];
}

/**
 * Expire requests past their date.
 *
 * Separate from the reminder sweep on purpose: a request expires whether or
 * not anybody was ever reminded, and folding the two would make an expiry
 * depend on a notification setting.
 */
async function expireOverdue(client) {
  const { rows } = await client.query(
    `UPDATE signature_request
        SET status = 'EXPIRED'
      WHERE status IN ('SENT','PARTIALLY_SIGNED')
        AND expires_at IS NOT NULL AND expires_at < now()
      RETURNING request_id, entity_ref`,
  );
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop -- a handful of rows per sweep,
    // and each event is independent.
    await emitEvent(client, {
      eventTypeKey: events.EXPIRED, moduleKey: events.MODULE, entityRef: r.entity_ref,
      actorUserId: null, payload: { request_id: r.request_id },
    }).catch(() => { /* @silent:storage — the state change is the part that must
      not fail; the event is the announcement. */ });
  }
  return rows.length;
}

/*
 * The internal step-up (Q9 = C, §6.5) lives in document_signature.service, next
 * to the signing choke point it guards. A second copy here would be a second
 * place for the threshold to drift; it is re-exported below so a caller holding
 * a request does not have to know which module owns the rule.
 */

module.exports = {
  create, get, list, dispatch, advance, decline, voidRequest,
  generateCertificate, dueReminders, remintSignToken, recordReminder, expireOverdue,
  assertUnamended, onAmendment, resolveAllowedPresets, presentParty,
  stepUpNeeded: (client, args) => sigService.stepUpNeeded(client, args),
  documentTotalXaf: (docType, doc) => sigService.documentTotalXaf(docType, doc),
  DEFAULT_EXPIRY_DAYS,
  // Re-exported so the public signing module has one import for the whole
  // aggregate rather than reaching past this service into its repo.
  repo, otp: otpService,
};
