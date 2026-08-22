/**
 * QES envelopes (MOD-64) — Tier 3, the certified signature.
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR RULES A REVIEWER SHOULD REJECT A PR OVER
 *
 * 1. CHARGE ON ISSUE, AND ONLY ON ISSUE (§7.4 step 3). The ledger row is
 *    written in the same transaction as the envelope's provider_ref, and
 *    `provider_ref NOT NULL` on the ledger makes "charged without an
 *    envelope" unrepresentable. A provider 5xx leaves the envelope FAILED
 *    and ZERO ledger rows (§7.6 criterion 2) — nothing to delete, because
 *    nothing was ever written.
 *
 * 2. THE WEBHOOK IS VERIFIED BEFORE IT IS TRUSTED (§7.4 step 5). The
 *    signature check runs on the raw body before any field of it is read,
 *    and a failure rejects with nothing from the body in the log (§7.6
 *    criterion 4). The verification is the provider's documented HMAC over
 *    the event type and time (see signwell.adapter.verifyWebhook).
 *
 * 3. A REPLAYED WEBHOOK WRITES ONE SIGNATURE, NOT TWO (§7.6 criterion 5).
 *    The claim is a guarded envelope transition (CREATING/SENT → COMPLETED,
 *    in the shape transitionRequest and settleParty already use), and the
 *    party settlement is guarded the same way. A second delivery — from the
 *    provider's retries, the poll backstop, or both — sees the claim taken
 *    and returns without touching anything.
 *
 * 4. THE SIGNATURE IS WRITTEN AT THE SAME STANDARD AS THE OTHERS. A QES
 *    completion re-derives the canonical hash and compares it to the
 *    request's snapshot (§1.3(a)): if the document moved after the provider
 *    was sent, the request goes AMENDED, the envelope fails, and no
 *    signature is written — a certified signature whose document no longer
 *    matches is not a signature, it is a finding.
 * ══════════════════════════════════════════════════════════════════════════
 */
"use strict";

const repo = require("./qes.repo");
const events = require("./qes.events");
const sigRepo = require("../document_signature/document_signature.repo");
const sigService = require("../document_signature/document_signature.service");
const requestService = require("../signature_request/signature_request.service");
const reqRepo = require("../signature_request/signature_request.repo");
const mail = require("../signature_request/signature_request.mail");
const vaultRepo = require("../document_vault/document_vault.repo");
const canonical = require("../../../services/signatures/canonical");
const tokens = require("../../../services/signatures/tokens");
const { getSetting, putSetting } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { originForSlug } = require("../../../services/signatures/verify-link");
const storage = require("../../../services/storage.service");
const crypto = require("crypto");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const qes = require("../../../services/qes");
const adapter = qes.resolveAdapter("signwell");

const lang = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

/** The webhook state row — see 10785's header for why it is a setting, not a table. */
const WEBHOOK_SETTING = { section: "qes", key: "webhook" };

/** The provider's terminal states, and how the envelope answers each. */
const TERMINAL = new Set(["COMPLETED", "DECLINED", "CANCELLED", "FAILED"]);

// ───────────────────────────────────────────────────────────────────────────
// The two tenant-facing reads (Settings panel, §3.11 panel 4)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The dispatch confirmation's pre-flight (§7.4 step 1).
 *
 * Informational, and it reports rather than blocks: the Round 2 narrowing
 * deleted the fee modal and the 424 CONFIG_MISSING path, so an unconfigured
 * provider is a fact the sender is shown ("certified signing is not set up"),
 * not a dispatch that fails. Dispatch itself succeeds, and the counterparty
 * gets the straight answer at the moment they pick the card.
 */
async function quote(client, { docType = null, language = "fr" }) {
  const L = lang(language);
  const flag = await presetsFlag(client);

  let ceilingOk = true;
  let ceilingReason = null;
  if (docType) {
    try {
      const { signaturePolicyFor } = require("../document_vault/document_vault.types");
      const ceiling = signaturePolicyFor(docType);
      ceilingOk = Boolean(ceiling && ceiling.allowsQes);
      if (!ceilingOk) ceilingReason = "NOT_AVAILABLE_FOR_DOC_TYPE";
    } catch {
      // An unregistered doc type cannot be certified; the menu would answer
      // the same. Not an error state for a pre-flight.
      ceilingOk = false;
      ceilingReason = "NOT_AVAILABLE_FOR_DOC_TYPE";
    }
  }

  const cfg = await providerConfigOrNull(client);
  const configured = Boolean(cfg);

  return {
    provider: "signwell",
    flag: { key: "signatures.qes", on: flag },
    configured,
    credential_source: cfg ? cfg.source : null,
    ceiling: { allows_qes: ceilingOk, reason: ceilingReason },
    available: flag && configured && ceilingOk,
    // The one line §7.4 step 1 keeps: no figure, no consent, a plain statement
    // of what the dispatch will consume.
    note: L === "en"
      ? "This will be sent for certified signature and will use one certified envelope from your monthly allowance."
      : "Ce document sera envoyé pour signature certifiée et utilisera une enveloppe certifiée de votre allowance mensuelle.",
  };
}

/**
 * This tenant's usage, read-only (§7.5): the count of envelopes issued this
 * month, and the state of the provider. No figure — "no tenant needs to see
 * the [unit] figure at all". The platform's quota is the platform's number;
 * what a tenant sees is its own consumption, which is the only number it can
 * act on.
 */
async function usage(client, { language = "fr" } = {}) {
  const flag = await presetsFlag(client);
  const cfg = await providerConfigOrNull(client);
  const now = new Date();
  const count = await repo.countForMonth(client, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });

  return {
    provider: "signwell",
    flag: { key: "signatures.qes", on: flag },
    configured: Boolean(cfg),
    credential_source: cfg ? cfg.source : null,
    month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    envelopes: count ? count.n : 0,
    language: lang(language),
  };
}

/**
 * Is `signatures.qes` on for this tenant? Same read as requireFeature — the
 * gate answers 403, and this field answers "off" in the body, so the two must
 * not drift. If the read fails, the whole request fails with it, so the
 * degradation is a formality kept for the shape, not a belief.
 */
async function presetsFlag(client) {
  try {
    const { rows } = await client.query(
      "SELECT state FROM feature_state WHERE feature_key = $1",
      ["signatures.qes"],
    );
    return rows.length ? rows[0].state === "on" : false;
  } catch {
    return false;
  }
}

async function providerConfigOrNull(client) {
  try {
    return await qes.providerConfig(client, "signwell");
  } catch (err) {
    logger.error({ err: err && err.message }, "QES credential resolution failed");
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The handoff — /complete with the CERTIFIED card
// ───────────────────────────────────────────────────────────────────────────

/**
 * Send the party to the provider.
 *
 * The provider does the identity check (that is what "certified" means —
 * Q14), so there is no OTP on this path and no email from us: the provider
 * emails the signer its own link. What happens here is the local half — the
 * envelope row, the provider call, and the charge in the transaction the
 * guide makes non-negotiable.
 *
 * The party is NOT settled: it is on the provider's side until the webhook
 * or the poll says otherwise, and the chain does not advance on hope.
 */
async function handoff(client, { party, request, language = "fr", slug = null, origin = null }) {
  const L = lang(language);

  const cfg = await qes.providerConfig(client, "signwell");
  if (!cfg) {
    throw new AppError(
      "QES_NOT_CONFIGURED",
      "Certified signing is not set up for this workspace yet.",
      409,
      { provider: "signwell" },
    );
  }

  // Rule: one in-flight envelope per party. The friendly half — the index
  // uq_qes_active_party is the half that stays true under a double-submitted
  // form, and its 23503 is translated below rather than surfaced raw.
  const inFlight = await repo.getActiveForParty(client, party.party_id);
  if (inFlight) {
    throw new AppError(
      "ENVELOPE_IN_FLIGHT",
      "This document is already with the certification provider. It will settle when they confirm.",
      409,
      { envelope_id: inFlight.envelope_id, status: inFlight.status },
    );
  }

  // The bytes the provider will sign. The VAULTED document, never a
  // re-render (§1.3(e) applies to the provider as much as to us: the
  // certified copy must be the copy the hashes describe).
  const docId = request.document_vault_id || (await sigRepo.listByRef(client, request.entity_ref).catch(() => []))[0]?.document_vault_id || null;
  if (!docId) {
    throw new AppError("NOT_READY", "This document has not been rendered yet.", 409);
  }
  const { buffer } = await vaultFetch(client, docId);

  const envelope = await repo.insertEnvelope(client, {
    request_id: request.request_id,
    party_id: party.party_id,
    provider_key: "signwell",
    status: "CREATING",
  });

  // The trim is a LOOP, not `replace(/\/+$/, "")` — the same decision
  // verify-link.normaliseBase records: a trailing quantifier on caller
  // input is the shape CodeQL's polynomial-redos wants, and the loop is
  // linear and obvious to a reader.
  let base = String(origin || originForSlug(slug || ""));
  while (base.endsWith("/")) base = base.slice(0, -1);
  const callbackUrl = `${base}/public/qes/signwell/webhook`;
  const hookId = await webhookIdFor(client, cfg.apiKey, callbackUrl);

  let created;
  try {
    created = await adapter.createEnvelope({
      apiKey: cfg.apiKey,
      document: {
        name: docTypeLabel(request.doc_type, L) || request.doc_type,
        fileName: `${String(request.entity_ref).replace(/[^\w.-]+/g, "_")}.pdf`,
        dataBase64: buffer.toString("base64"),
      },
      parties: [{ email: party.email, name: party.full_name, role: party.party_role || null, signingOrder: 1 }],
      callbackUrl,
      webhookId: hookId,
      language: L,
      metadata: { praxis: { envelope_id: envelope.envelope_id, request_id: request.request_id, entity_ref: request.entity_ref } },
    });
  } catch (err) {
    // The provider said no. The envelope goes FAILED with the reason, and
    // NO ledger row exists — the charge-on-issue rule means a failure
    // costs nothing (§7.4 step 4). The signer can try again, or pick
    // another card; the party was never settled.
    const reason = providerReason(err);
    await repo.updateEnvelope(client, envelope.envelope_id, { status: "FAILED", last_error: reason })
      .catch(() => { /* @silent:storage — the failure is already the answer */ });
    throw new AppError("QES_PROVIDER_ERROR", `The certification provider could not accept the document: ${reason}`, 502,
      { provider: "signwell" });
  }

  // The charge, in the same transaction as the ref (rule 1).
  const pricing = await qes.platformPricing();
  try {
    await client.query("BEGIN");
    await repo.updateEnvelope(client, envelope.envelope_id, {
      provider_ref: created.envelopeId,
      status: "SENT",
    });
    await repo.chargeForEnvelope(client, {
      envelopeId: envelope.envelope_id,
      requestId: request.request_id,
      entityRef: request.entity_ref,
      providerKey: "signwell",
      providerRef: created.envelopeId,
      unitFee: pricing.unitCost,
      currency: pricing.currency,
    });
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK").catch(() => { /* @silent:teardown — the rollback IS the cleanup */ });
    // The provider has a document we will not have billed. Cancel it rather
    // than leak quota: the provider consumed nothing we were going to pay
    // for, and leaving an open document with a signable link in a mailbox
    // nobody is watching is worse than the DELETE.
    try {
      await adapter.cancelEnvelope({ apiKey: cfg.apiKey, envelopeId: created.envelopeId, reason: "charge transaction failed" });
    } catch {
      // @silent:storage — a cancel that fails is logged, and the poll backstop
      // will find the orphan; it must not mask the original error.
      logger.error({ envelope_id: envelope.envelope_id, provider_ref: created.envelopeId }, "could not cancel orphaned QES envelope");
    }
    throw new AppError("QES_LEDGER_FAILED", "The envelope was sent but could not be recorded. It has been cancelled — please try again.", 500,
      { provider: "signwell" });
  }

  await emitEvent(client, {
    eventTypeKey: events.ENVELOPE_CREATED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    actorUserId: null,
    payload: {
      envelope_id: envelope.envelope_id, request_id: request.request_id,
      party_id: party.party_id, provider: "signwell", credential_source: cfg.source,
    },
  });
  await audit(client, {
    actorUserId: null, action: events.ENVELOPE_CREATED, moduleKey: events.MODULE, entityRef: request.entity_ref,
    after: {
      envelope_id: envelope.envelope_id, request_id: request.request_id,
      party_id: party.party_id, provider_ref: created.envelopeId, credential_source: cfg.source,
    },
  });

  return {
    sent: true,
    provider: "signwell",
    envelope_id: envelope.envelope_id,
    // Bilingual and plain: the next step is an email from a DIFFERENT sender,
    // and the counterparty must not mistake that for a mistake.
    note: L === "en"
      ? "The certification provider will email the signer a secure link. This request settles when they confirm."
      : "Le prestataire de certification enverra un lien sécurisé au signataire. Cette demande se clôture à leur confirmation.",
  };
}

async function vaultFetch(client, docId) {
  const vault = require("../document_vault/document_vault.service");
  return vault.fetchBytes(client, docId);
}

/**
 * The webhook id for a tenant's callback URL, idempotent.
 *
 * Stored as a tenant setting (`qes.webhook`), not a table, on purpose: it is
 * machine state the settings surface must never render (the settings hub
 * reads the sections it is told to, and `qes` is not one of them), and it is
 * credential-adjacent — the id is the HMAC key for this tenant's webhooks,
 * which means it must live in the tenant database, never in the platform
 * vault, never in .env.
 */
async function webhookIdFor(client, apiKey, callbackUrl) {
  const existing = await getSetting(client, WEBHOOK_SETTING.section, WEBHOOK_SETTING.key, null);
  if (existing && existing.provider_key === "signwell" && existing.callback_url === callbackUrl && existing.webhook_id) {
    return existing.webhook_id;
  }
  const { webhookId: hookId } = await adapter.ensureWebhook({ apiKey, callbackUrl });
  await putSetting(client, {
    section: WEBHOOK_SETTING.section, key: WEBHOOK_SETTING.key,
    value: { provider_key: "signwell", webhook_id: hookId, callback_url: callbackUrl },
    actor: {},
  }).catch(() => { /* @silent:storage — the id is re-derivable by list; losing
      the note must not fail a signing session. */ });
  return hookId;
}

/** The webhook id, or null — the verification key for incoming events. */
async function webhookId(client) {
  const row = await getSetting(client, WEBHOOK_SETTING.section, WEBHOOK_SETTING.key, null);
  return row && row.provider_key === "signwell" ? row.webhook_id || null : null;
}

function providerReason(err) {
  if (err && err.name === "ProviderError") return err.message;
  if (err && err.code === "QES_PROVIDER_ERROR") return err.message;
  return (err && err.message) || "provider error";
}

// ───────────────────────────────────────────────────────────────────────────
// The provider event — webhook and poll share one function
// ───────────────────────────────────────────────────────────────────────────

/**
 * Advance an envelope from a provider state.
 *
 * Called by the webhook (the fast path) and by the poll backstop (the path
 * that exists because webhooks get lost, §7.4 step 6). One function on
 * purpose: two implementations of "what does COMPLETED mean" would have
 * disagreed by the first edge case, and the edge cases of a signature
 * settle in production, not in review.
 */
async function handleProviderEvent(client, { providerRef, providerStatus, source = "webhook", slug = null, tenantName = "" }) {
  if (!providerRef) return { ignored: true, reason: "no provider ref" };

  const envelope = await repo.getEnvelopeByProviderRef(client, "signwell", providerRef);
  if (!envelope) {
    // Not ours: another tenant's event, or a provider document this system
    // never sent. A 404 at the HTTP edge is the webhook's job; here the
    // answer is simply "nothing to do", and the poll that found it moves on.
    logger.debug({ source, provider_ref: providerRef }, "QES event for an unknown envelope");
    return { ignored: true, reason: "unknown envelope" };
  }

  // Terminal envelopes answer the same way to every delivery: nothing.
  // This is criterion 5's other half — the provider retries a webhook until
  // it gets 2xx, and a completion that wrote its signature the first time
  // must not write a second.
  if (TERMINAL.has(envelope.status)) return { ignored: true, reason: `envelope already ${envelope.status}` };

  if (providerStatus === "FAILED") {
    const row = await repo.transitionEnvelope(client, envelope.envelope_id, "FAILED", ["CREATING", "SENT"], { last_error: "provider reported a failure" });
    if (row) await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, { status: "FAILED", source });
    return { envelope_id: envelope.envelope_id, status: row ? "FAILED" : envelope.status };
  }

  if (providerStatus === "CANCELLED") {
    const row = await repo.transitionEnvelope(client, envelope.envelope_id, "CANCELLED", ["CREATING", "SENT"], { last_error: "cancelled on the provider's side" });
    if (row) await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, { status: "CANCELLED", source });
    return { envelope_id: envelope.envelope_id, status: row ? "CANCELLED" : envelope.status };
  }

  if (providerStatus === "DECLINED") {
    return declinedEnvelope(client, envelope, source, slug, tenantName);
  }

  if (providerStatus === "COMPLETED") {
    return completedEnvelope(client, envelope, source, slug, tenantName);
  }

  // A non-terminal state (sent, viewed, in progress, signed-by-one): the
  // envelope is on its way. Nothing to do, and nothing to log loudly —
  // this is the poll's normal heartbeat, not an event.
  return { ignored: true, reason: `provider status ${providerStatus} is not terminal` };
}

async function emitEnvelopeEvent(client, key, envelope, payload) {
  try {
    await emitEvent(client, {
      eventTypeKey: key, moduleKey: events.MODULE, entityRef: null,
      actorUserId: null,
      payload: { envelope_id: envelope.envelope_id, request_id: envelope.request_id, ...payload },
    });
  } catch (err) {
    // The event is the announcement; the envelope row is the fact. A
    // notification failure must not turn a settled envelope into an error.
    logger.warn({ err: err && err.message, envelope_id: envelope.envelope_id }, "QES envelope event could not be emitted");
  }
}

/**
 * The provider's decline. The party settles DECLINED, the request settles
 * with the reason visible to the creator, and — exactly as with the OTP
 * path — a decline does NOT cancel earlier signatures: they remain valid
 * records of what those parties attested to (§6.6).
 */
async function declinedEnvelope(client, envelope, source, _slug, _tenantName) {
  // The claim, so the webhook and the poll cannot both decline.
  const claimed = await repo.transitionEnvelope(client, envelope.envelope_id, "DECLINED", ["CREATING", "SENT"]);
  if (!claimed) return { ignored: true, reason: "concurrent settle" };

  const party = await reqRepo.getParty(client, envelope.party_id);
  const request = await reqRepo.getRequest(client, envelope.request_id);

  if (party && ["PENDING", "SENT", "VIEWED"].includes(party.status) && request
    && ["DRAFT", "SENT", "PARTIALLY_SIGNED"].includes(request.status)) {
    await requestService.decline(client, {
      request, party,
      reason: "Declined via the certification provider",
      actor: {},
    }).catch((err) => logger.warn({ err: err && err.message, envelope_id: envelope.envelope_id }, "QES decline could not settle the chain"));
  }

  await emitEnvelopeEvent(client, events.ENVELOPE_DECLINED, envelope, { status: "DECLINED", source });
  await audit(client, {
    actorUserId: null, action: events.ENVELOPE_DECLINED, moduleKey: events.MODULE,
    entityRef: request ? request.entity_ref : null,
    after: { envelope_id: envelope.envelope_id, request_id: envelope.request_id, party_id: envelope.party_id, source },
  });

  return { envelope_id: envelope.envelope_id, status: "DECLINED" };
}

/**
 * Completion — the long one, and the one the rules above live in.
 *
 * Order of operations, and why:
 *   1. claim the envelope (guarded transition) — the arbiter of the race
 *   2. check the request is still open, the party still unsettled
 *   3. re-derive the canonical hash (rule 4)
 *   4. fetch both provider artifacts
 *   5. mirror them into the vault
 *   6. settle the party (guarded) — the second arbiter
 *   7. write the signature row, advance the chain, certificate
 * A failure anywhere in 3–7 puts the claim back (the poll retries) or takes
 * the envelope to FAILED when the failure is one that will not heal.
 */
async function completedEnvelope(client, envelope, source, slug, tenantName) {
  await repo.lockEnvelope(client, envelope.envelope_id);

  // 1. The claim.
  const claimed = await repo.transitionEnvelope(client, envelope.envelope_id, "COMPLETED", ["CREATING", "SENT"], { last_error: null });
  if (!claimed) return { ignored: true, reason: "concurrent settle" };

  const party = await reqRepo.getParty(client, envelope.party_id);
  const request = await reqRepo.getRequest(client, envelope.request_id);

  // 2. Guards. A request that closed (voided, amended by another path,
  //    completed) while the provider was working is not an envelope that can
  //    settle: the signature would attest to a chain that is over.
  if (!request || !["DRAFT", "SENT", "PARTIALLY_SIGNED"].includes(request.status)) {
    await unclaim(client, envelope.envelope_id, "the request closed before the provider finished");
    return { envelope_id: envelope.envelope_id, status: "CANCELLED" };
  }
  if (!party || !["PENDING", "SENT", "VIEWED"].includes(party.status)) {
    // The party settled some other way (the OTP path, a decline) while the
    // provider was working. The provider's signature is a duplicate of an
    // act that already happened — it is recorded as such, and not written
    // as a second signature.
    await unclaim(client, envelope.envelope_id, "the party settled by another method");
    return { envelope_id: envelope.envelope_id, status: "CANCELLED" };
  }

  // 3. Rule 4 — the amendment check, before any bytes are trusted.
  let liveDoc = null;
  try {
    liveDoc = await sigService.loadDoc(client, { docType: request.doc_type, entityRef: request.entity_ref });
  } catch {
    /* @silent:parse — an unreadable document cannot be compared; the refusal
       below is the honest answer. */
  }
  if (!liveDoc) {
    await unclaim(client, envelope.envelope_id, "the document could not be read to re-check the hash");
    return { envelope_id: envelope.envelope_id, status: "FAILED" };
  }
  const currentHash = canonical.hash(request.doc_type, liveDoc, request.payload_version);
  if (currentHash !== request.content_hash) {
    // The document moved after the provider was sent. §1.3(a), in full:
    // the chain stops, the signed parties are told, the flag is raised, and
    // the envelope records WHY it failed rather than writing a signature
    // for a payload that is no longer the one on the page.
    await requestService.onAmendment(client, request, liveDoc, currentHash);
    await repo.transitionEnvelope(client, envelope.envelope_id, "FAILED", ["COMPLETED"],
      { last_error: "document amended after the provider was sent" });
    await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, {
      status: "FAILED", source, reason: "amended",
      signed_hash: request.content_hash, current_hash: currentHash,
    });
    return { envelope_id: envelope.envelope_id, status: "FAILED" };
  }

  // 4–7, with the claim put back on anything that can heal.
  try {
    const cfg = await qes.providerConfig(client, "signwell");
    if (!cfg) throw new AppError("QES_NOT_CONFIGURED", "No signing provider credentials are configured.", 409);

    const signedBuf = await adapter.fetchSignedDocument({ apiKey: cfg.apiKey, envelopeId: envelope.provider_ref });
    const auditBuf = await adapter.fetchAuditCertificate({ apiKey: cfg.apiKey, envelopeId: envelope.provider_ref });

    const signedDoc = await vaultMirror(client, {
      slug, envelope, buffer: signedBuf, docType: request.doc_type, entityRef: request.entity_ref, label: "signed",
    });
    const auditDoc = await vaultMirror(client, {
      slug, envelope, buffer: auditBuf, docType: "QES_AUDIT_CERTIFICATE", entityRef: request.entity_ref, label: "audit",
    });

    // 6. The party settlement — the second arbiter of the race.
    const settled = await reqRepo.settleParty(client, party.party_id, "SIGNED");
    if (!settled) {
      await unclaim(client, envelope.envelope_id, "the party settled by another method");
      return { envelope_id: envelope.envelope_id, status: "CANCELLED" };
    }

    // 7. The signature row — the act, at the same standard as the others.
    const signedAt = new Date();
    const row = await sigRepo.insert(client, {
      entity_ref: request.entity_ref,
      doc_type: request.doc_type,
      document_vault_id: signedDoc.doc_id,
      payload_version: request.payload_version,
      content_hash: currentHash,
      content_payload: JSON.stringify(canonical.canonical(request.doc_type, liveDoc, request.payload_version)),
      artifact_hash: crypto.createHash("sha256").update(signedBuf).digest("hex"),
      assurance_level: "QES",
      visual_mark: "PROVIDER",
      preset_code: "CERTIFIED",
      party: "EXTERNAL",
      // The name is CLAIMED (stated on the signing page); what the provider
      // proved is the identity behind it — which is precisely why the
      // certificate prints the provider's audit rather than pretending we
      // verified the name (§1.3(d), in its QES form).
      identity_source: "DECLARED",
      signer_name: party.full_name,
      signer_role: party.party_role || null,
      signer_email: party.email,
      signature_request_id: request.request_id,
      verify_code: tokens.mintVerifyCode(),
      signed_at: signedAt,
      // ip / user_agent: captured on the provider's side, in the audit
      // certificate we just vaulted. Ours would be the WEBHOOK's address —
      // the provider's exit node — and printing that as the signer's
      // location would be a false fact in an evidence document.
      ip: null,
      user_agent: null,
    });

    await repo.updateEnvelope(client, envelope.envelope_id, {
      signed_vault_id: signedDoc.doc_id,
      audit_vault_id: auditDoc.doc_id,
    });

    await emitEvent(client, {
      eventTypeKey: events.ENVELOPE_COMPLETED, moduleKey: events.MODULE, entityRef: request.entity_ref,
      actorUserId: null,
      payload: {
        envelope_id: envelope.envelope_id, request_id: request.request_id,
        party_id: party.party_id, signature_id: row.signature_id,
        signed_vault_id: signedDoc.doc_id, audit_vault_id: auditDoc.doc_id, source,
      },
    });
    await emitEvent(client, {
      eventTypeKey: "document_signature.signed", moduleKey: events.MODULE, entityRef: request.entity_ref,
      actorUserId: null,
      payload: {
        signature_id: row.signature_id, request_id: request.request_id, party_id: party.party_id,
        preset_code: "CERTIFIED", assurance_level: "QES",
      },
    });
    await audit(client, {
      actorUserId: null, action: events.ENVELOPE_COMPLETED, moduleKey: events.MODULE, entityRef: request.entity_ref,
      after: {
        envelope_id: envelope.envelope_id, request_id: request.request_id, party_id: party.party_id,
        signature_id: row.signature_id, content_hash: currentHash,
        signed_vault_id: signedDoc.doc_id, audit_vault_id: auditDoc.doc_id, source,
      },
    });

    // The chain moves on, and the next party gets their link BY EMAIL — the
    // webhook has no operator to press "send next link", and a chain that
    // waits for one is the stall §7.4 step 6 exists to prevent.
    const advanced = await requestService.advance(client, {
      request, party: settled, actor: {}, language: "fr",
      sendEmail: makeMailer(client, { slug, tenantName }),
    });

    // The certificate, on the final signature — best-effort against the
    // signature, exactly as the OTP path does it (§6.7's reasoning applies
    // to a webhook as much as a request: the act has happened, the evidence
    // is recoverable, and neither may lose the other).
    let certificate = null;
    if (advanced.completed === true) {
      try {
        certificate = await requestService.generateCertificate(client, {
          id: request.request_id, origin: originForSlug(slug || ""), language: "fr",
        });
      } catch (err) {
        logger.error({ err: err && err.message, request_id: request.request_id },
          "certificate of completion could not be generated after QES completion");
      }
    }

    return { envelope_id: envelope.envelope_id, status: "COMPLETED", signature_id: row.signature_id, certificate_doc_id: certificate ? certificate.doc_id : null };
  } catch (err) {
    // Healable or not: a ProviderError carries the provider's own answer,
    // and a 4xx from the provider is not going to change on retry.
    const healable = !(err && err.name === "ProviderError" && err.retryable === false);
    if (healable) {
      await repo.transitionEnvelope(client, envelope.envelope_id, "SENT", ["COMPLETED"], { last_error: providerReason(err) })
        .catch(() => { /* @silent:storage — the poll will find the envelope either way */ });
      logger.error({ err: err && err.message, envelope_id: envelope.envelope_id, source }, "QES completion failed — claim returned to the poll");
    } else {
      await repo.transitionEnvelope(client, envelope.envelope_id, "FAILED", ["COMPLETED"], { last_error: providerReason(err) })
        .catch(() => { /* @silent:storage — ditto */ });
      await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, { status: "FAILED", source, reason: providerReason(err) });
      logger.error({ err: err && err.message, envelope_id: envelope.envelope_id, source }, "QES completion failed permanently");
    }
    return { envelope_id: envelope.envelope_id, status: healable ? "RETRY" : "FAILED" };
  }
}

/**
 * Put a claim back. From COMPLETED, an unclaimed envelope goes to CANCELLED
 * (the request or the party settled elsewhere — the provider's document is
 * over, and leaving it COMPLETED would mean "signed" when nothing was) with
 * the reason, or to FAILED when the failure is the document's own (it could
 * not be read to re-check the hash) — the poll will not heal that by asking
 * again, and the operator needs the distinction.
 */
async function unclaim(client, envelopeId, reason) {
  const target = reason.startsWith("the document") ? "FAILED" : "CANCELLED";
  await repo.transitionEnvelope(client, envelopeId, target, ["COMPLETED"], { last_error: reason })
    .catch(() => { /* @silent:storage — the envelope row keeps whatever state the race left */ });
  await emitEvent(client, {
    eventTypeKey: events.ENVELOPE_FAILED, moduleKey: events.MODULE, entityRef: null,
    actorUserId: null, priority: "HIGH",
    payload: { envelope_id: envelopeId, reason },
  }).catch(() => { /* @silent:storage — the reason is on the row; the event is the alarm */ });
}

/**
 * Mirror one provider artifact into the vault.
 *
 * A STANDALONE row (like createDocument), not capture's update-in-sync: the
 * provider's signed PDF is a new version of the document, and overwriting
 * the original row would move the artifact that every earlier signature's
 * portal verdict compares against. The original row stays; the signed row
 * is what the new signature's artifact_hash describes, and the portal's
 * verdict is per-signature (it reads the signature's own document_vault_id).
 *
 * The storage key is deterministic on the envelope id, so a poll retry after
 * a partial failure overwrites the same object rather than leaving an
 * orphan per attempt.
 */
async function vaultMirror(client, { slug, envelope, buffer, docType, entityRef, label }) {
  const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const key = `tenant_${slug || "unknown"}/qes/${envelope.envelope_id}_${label}.pdf`;
  await storage.put(buffer, { key, contentType: "application/pdf" });
  return vaultRepo.insert(client, {
    entity_ref: entityRef,
    doc_type: docType,
    storage_path: key,
    content_hash: contentHash,
    status: "VERIFIED",
  });
}

// ───────────────────────────────────────────────────────────────────────────
// The poll backstop (§7.4 step 6)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every non-terminal envelope older than the given age, advanced against the
 * provider's own answer.
 *
 * Webhooks get lost — the provider's retry window is not infinite, and a
 * tenant behind a flaky edge can miss every one. A chain that stalls
 * invisibly is worse than a redundant poll (§7.4), so the poll asks the
 * provider "where is this document?" for everything it is still owed.
 */
async function pollTenant(client, { slug = null, tenantName = "", olderThanHours = 1, source = "poll" }) {
  const stale = await repo.listStaleOpen(client, olderThanHours);
  let progressed = 0;
  let failed = 0;

  for (const envelope of stale) {
    try {
      // A CREATING envelope with no provider_ref is a create call whose
      // answer was lost. The provider cannot have it — or can it: the
      // document may exist over there without our knowing its id. There is
      // no list-by-metadata call in the verified API surface, so the honest
      // answer is FAILED with a reason the operator can act on: re-send.
      if (!envelope.provider_ref) {
        const row = await repo.transitionEnvelope(client, envelope.envelope_id, "FAILED", ["CREATING"],
          { last_error: "the provider never confirmed the document; send the request again" });
        if (row) {
          await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, { status: "FAILED", source, reason: "create never confirmed" });
          failed += 1;
        }
        continue;
      }
      const cfg = await qes.providerConfig(client, "signwell");
      if (!cfg) {
        // Not configured: nothing to poll, and marking the envelope FAILED
        // would be a lie (the provider may still be working). Leave it; the
        // operator's configuration is the blocker, and the job log says so.
        logger.warn({ envelope_id: envelope.envelope_id, slug }, "QES poll skipped — provider not configured");
        continue;
      }
      const status = await adapter.getStatus({ apiKey: cfg.apiKey, envelopeId: envelope.provider_ref });
      const out = await handleProviderEvent(client, {
        providerRef: envelope.provider_ref,
        providerStatus: status.status,
        source,
        slug,
        tenantName,
      });
      if (!out.ignored) progressed += 1;
    } catch (err) {
      // One unreachable envelope must not stop the sweep for the rest.
      // A retryable provider blip leaves the envelope where it is — the
      // next half-hour asks again.
      failed += 1;
      logger.warn({ err: err && err.message, envelope_id: envelope.envelope_id, slug }, "QES poll could not advance an envelope");
    }
  }

  logger.debug({ checked: stale.length, progressed, failed, slug }, "[qes] poll sweep");
  return { checked: stale.length, progressed, failed };
}

// ───────────────────────────────────────────────────────────────────────────
// Cancellation — the void path (§7.4 step 7)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cancel every in-flight envelope on a request being voided.
 *
 * The ledger row STAYS: non-refundable once the provider ref is issued —
 * "the provider consumed the quota whatever we do. Do not add a refund
 * path; that was decided" (§7.4 step 7). What goes is the provider's
 * document and its signable link.
 *
 * Best-effort throughout: a provider that will not take the cancel must not
 * hold the void hostage. The request is being voided regardless; the
 * envelope keeps whatever state the cancel left it in, and the poll will
 * report the mismatch.
 */
async function cancelForRequest(client, { requestId, actor = {} }) {
  const active = await repo.listActiveForRequest(client, requestId);
  let cancelled = 0;

  for (const envelope of active) {
    try {
      if (envelope.provider_ref) {
        const cfg = await qes.providerConfig(client, "signwell").catch(() => null);
        if (cfg) {
          await adapter.cancelEnvelope({ apiKey: cfg.apiKey, envelopeId: envelope.provider_ref, reason: "request voided" });
        }
      }
      const row = await repo.transitionEnvelope(client, envelope.envelope_id, "CANCELLED", ["CREATING", "SENT"],
        { last_error: "request voided" });
      if (row) {
        cancelled += 1;
        await emitEnvelopeEvent(client, events.ENVELOPE_FAILED, envelope, { status: "CANCELLED", source: "void", reason: "request voided" });
        await audit(client, {
          actorUserId: actor.user_id || null, action: events.ENVELOPE_FAILED, moduleKey: events.MODULE,
          entityRef: null,
          after: { envelope_id: envelope.envelope_id, request_id: requestId, cancelled: true },
        });
      }
    } catch (err) {
      logger.warn({ err: err && err.message, envelope_id: envelope.envelope_id }, "QES envelope could not be cancelled on void");
    }
  }

  return { cancelled, of: active.length };
}

// ───────────────────────────────────────────────────────────────────────────
// The mailer the chain-advance uses when a QES completion sends the next link
// ───────────────────────────────────────────────────────────────────────────

/** The doc type in words, from the template registry's own bilingual title. */
function docTypeLabel(docType, language) {
  try {
    const registry = require("../../../services/documents/templates/registry");
    const tpl = registry.get(docType);
    if (tpl && tpl.title) return language === "en" ? tpl.title.en : tpl.title.fr;
  } catch {
    /* @silent:parse — an unregistered doc type has no title to resolve. */
  }
  return null;
}

/**
 * The next party's link, from a context that has no HTTP request.
 *
 * The worker has no req, so the host comes from the tenant's own slug — the
 * same resolution the QR and the reminder use (services/signatures/verify-link.js).
 */
function makeMailer(client, { slug, tenantName }) {
  const origin = slug ? originForSlug(slug) : null;
  return async ({ party, request, token, language }) => {
    if (!origin) {
      logger.error({ request_id: request.request_id }, "QES chain advance could not resolve the signing host");
      return;
    }
    const url = `${origin}/sign/${encodeURIComponent(token)}`;
    const label = docTypeLabel(request.doc_type, language);
    const { subject, html, text } = mail.signingLinkEmail({
      party,
      request: {
        doc_type: request.doc_type, doc_type_label: label, entity_ref: request.entity_ref,
        message: request.message, expires_at: request.expires_at,
      },
      url,
      tenantName: tenantName || "",
      language,
    });
    await mail.send(client, {
      to: party.email, subject, html, text,
      entityRef: request.entity_ref, sendPoint: "signature.request",
    });
  };
}

module.exports = {
  quote, usage, handoff, handleProviderEvent, pollTenant, cancelForRequest, webhookId,
};
