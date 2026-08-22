/**
 * The public verification portal (MOD-66) —
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §5.4, §5.5.
 *
 * A stranger holding a piece of paper scans the QR printed on it, or types the
 * twelve characters underneath. This is what answers them.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR RULES THIS FILE EXISTS TO KEEP
 *
 * 1. THE SUMMARY IS THE DOCUMENT AS SIGNED, NEVER A LIVE QUERY. (Q12 = B,
 *    §1.5(d)). It renders from `document_signature.content_payload` — the
 *    canonical struct frozen at signing time. A live query would let an OLD
 *    copy disclose the CURRENT state: someone holding a March waybill scans it
 *    in September and reads today's line items, today's counterparty, today's
 *    amendments. Facts that were never on their paper.
 *
 *    The ONLY live computation on this page is the hash comparison that
 *    produces the two verdicts.
 *
 * 2. UNKNOWN IS ONE ANSWER. A malformed code and a code that never existed
 *    return the SAME 404 with the SAME body. Distinguishing them turns the
 *    portal into an oracle that confirms which codes are real, and the code
 *    space is 2^60 — small enough that an oracle plus time is a working attack.
 *
 * 3. THE PUBLIC READ IS PINNED TO LIVE. The routes layer does this
 *    (`req.tenantDbIn("live", …)`), and it is stated here too because it is the
 *    kind of thing a later refactor "simplifies" back to `req.tenantDb`.
 *
 * 4. NOTHING HERE PRINTS A FULL IP. §3.13 — masked through
 *    services/signatures/mask.js, which is the only formatter allowed to.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── What replaced what ─────────────────────────────────────────────────────
 * This module used to resolve a doc by `doc_id` or `entity_ref` plus a hash
 * FRAGMENT, and match it with `stored.startsWith(hash)` against a validator
 * whose floor was FOUR characters. Sixteen bits of hex, against a public
 * endpoint with no rate limiter: verification succeeded on a prefix an attacker
 * could enumerate in seconds, and — worse — the caller supplied the identifier
 * of the document they wanted checked, so a "verified" verdict proved nothing
 * about the paper in their hand.
 *
 * There is now no prefix path, no `min(4)`, and no caller-supplied target: one
 * exact lookup on a unique-indexed credential that only the printed document
 * carries.
 */
"use strict";

const repo = require("./document_verification.repo");
const sigRepo = require("../document_signature/document_signature.repo");
const sigService = require("../document_signature/document_signature.service");
const events = require("./document_verification.events");
const canonical = require("../../../services/signatures/canonical");
const summary = require("../../../services/signatures/summary");
const tokens = require("../../../services/signatures/tokens");
const presets = require("../../../services/signatures/presets");
const { maskIp, coarseUserAgent } = require("../../../services/signatures/mask");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/** §5.4: one answer for "no such verification", whatever the input looked like. */
const notFound = () =>
  new AppError("NOT_FOUND", "No verification matches that code.", 404);

/**
 * How the visitor arrived. A Map, not an object literal: `via` comes off the
 * query string, and `VIA["constructor"]` on a plain literal is a truthy,
 * callable value that would sail past a `|| "QR"` fallback and land a function
 * in a CHECK-constrained column (CodeQL js/unvalidated-dynamic-method-call —
 * the same finding class as canonical.js's builder table).
 */
const VIA = new Map([["QR", "QR"], ["CODE", "CODE"]]);
const viaOf = (v) => VIA.get(String(v || "").toUpperCase()) || "QR";

/**
 * FR by default, not EN.
 *
 * This is a Cameroonian product and the counterparty reading this page is more
 * often francophone than not (§3.14). The visitor's own `?lang=` wins, because
 * they are the one reading it.
 */
const langOf = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

const t = (pair, lang) => (lang === "en" ? pair.en : pair.fr);

/**
 * The two verdicts, on separate lines and never conflated. This is what Q2 = C
 * bought: two hashes answering two different questions.
 *
 *   CONTENT  — does the record still say what was signed? Recomputed from the
 *              live document, which is why it can go stale and the artifact
 *              verdict cannot.
 *   ARTIFACT — is this file the exact one we issued? Frozen at render time.
 *
 * A document can pass one and fail the other, and that combination is
 * informative rather than contradictory: a valid artifact with a failed content
 * verdict is precisely "this is our PDF, and the record behind it has moved on".
 */
function contentVerdict(sig, liveDoc, lang) {
  if (!liveDoc) {
    return {
      key: "content",
      state: "UNKNOWN",
      label: t({ fr: "Contenu", en: "Content" }, lang),
      message: t({
        fr: "Le document d'origine n'a pas pu être relu, donc son contenu ne peut pas être comparé.",
        en: "The original record could not be read, so its contents cannot be compared.",
      }, lang),
    };
  }
  let now = null;
  try {
    now = canonical.hash(sig.doc_type, liveDoc, sig.payload_version);
  } catch (err) {
    logger.warn({ err: err && err.message, doc_type: sig.doc_type }, "portal could not recompute the canonical hash");
    return {
      key: "content",
      state: "UNKNOWN",
      label: t({ fr: "Contenu", en: "Content" }, lang),
      message: t({
        fr: "Le contenu de ce document ne peut pas être vérifié automatiquement.",
        en: "This document's contents cannot be checked automatically.",
      }, lang),
    };
  }
  const ok = now === sig.content_hash;
  return {
    key: "content",
    state: ok ? "PASS" : "FAIL",
    label: t({ fr: "Contenu", en: "Content" }, lang),
    message: ok
      ? t({
        fr: "Ce document dit toujours ce qui a été signé.",
        en: "This document still says what was signed.",
      }, lang)
      : t({
        fr: "Ce document a été modifié après signature. La signature ci-dessous ne couvre plus son contenu actuel.",
        en: "This document was modified after signing. The signature below no longer covers its current contents.",
      }, lang),
  };
}

function artifactVerdict(sig, vaulted, lang) {
  const label = t({ fr: "Fichier", en: "Artifact" }, lang);
  if (!sig.artifact_hash || !vaulted) {
    return {
      key: "artifact",
      state: "UNKNOWN",
      label,
      message: t({
        fr: "Aucun fichier n'a encore été archivé pour cette signature.",
        en: "No file has been archived for this signature yet.",
      }, lang),
    };
  }
  const ok = sig.artifact_hash === vaulted.content_hash;
  return {
    key: "artifact",
    state: ok ? "PASS" : "FAIL",
    label,
    message: ok
      ? t({ fr: "Ce fichier est exactement celui que nous avons émis.", en: "This file is the exact one we issued." }, lang)
      : t({
        fr: "Le fichier archivé ne correspond plus à celui qui a été signé.",
        en: "The archived file no longer matches the one that was signed.",
      }, lang),
  };
}

/** Plain language, never an enum. "AES_OTP" is not a word a court should meet. */
const methodWords = (level, lang) => sigService.methodWords(level, lang);

/**
 * The identity block. `identity_source` is surfaced rather than smoothed over
 * (§1.3(d)): a name the system resolved from an authenticated session and a
 * name somebody typed into a form are different claims, and a verifier is
 * entitled to know which one they are looking at.
 */
function signerBlock(sig, lang) {
  return {
    name: sig.signer_name,
    role: sig.signer_role || null,
    party: sig.party,
    identity_source: sig.identity_source,
    identity_words: sig.identity_source === "SESSION"
      ? t({
        fr: "Nom confirmé par le compte utilisé pour signer",
        en: "Name confirmed by the account used to sign",
      }, lang)
      : t({
        fr: "Nom déclaré par le signataire",
        en: "Name declared by the signer",
      }, lang),
    method: methodWords(sig.assurance_level, lang),
    reason: sig.sign_reason || null,
    preset_code: sig.preset_code || null,
    signed_at: sig.signed_at,
    // §3.13. maskIp is the ONLY formatter allowed to produce this string.
    ip: maskIp(sig.ip),
    device: coarseUserAgent(sig.user_agent, lang),
  };
}

/**
 * Record the visit: one queryable row, one ledger entry, and the two signals.
 *
 * Both writes are deliberate (§5.5). The ledger is append-only and is the
 * evidentiary copy; `signature_scan` is the projection that makes the new-IP
 * check and the rolling-hour window answerable without scanning the audit
 * history. Scans are rare; two writes are not a concern.
 *
 * Best-effort as a whole: a visitor asking whether their document is genuine
 * must get an answer even if the telemetry behind it fails. Logging a scan is
 * how the tenant learns something; refusing to answer is how the product
 * fails the only person on the page.
 */
async function logScan(client, sig, { ip, userAgent, referrer, via }) {
  try {
    const isNewIp = ip ? !(await sigRepo.scanSeenFromIp(client, sig.signature_id, ip)) : false;

    await sigRepo.insertScan(client, {
      signature_id: sig.signature_id,
      ip: ip || null,
      user_agent: userAgent || null,
      referrer: referrer || null,
      via,
      is_new_ip: isNewIp,
    });

    await audit(client, {
      actorUserId: null,
      action: events.SCANNED,
      moduleKey: events.SIGNATURE_MODULE,
      entityRef: sig.entity_ref,
      after: { signature_id: sig.signature_id, via, is_new_ip: isNewIp, ip: maskIp(ip) },
      // The full value goes in the ledger's own `ip` column, which is what
      // §3.13 means by "store the full value": masked in anything rendered,
      // whole in the evidentiary record.
      ip: ip || null,
    });

    await afterScan(client, sig, { isNewIp, via });
    return isNewIp;
  } catch (err) {
    logger.warn({ err: err && err.message, signature_id: sig.signature_id }, "scan logging failed");
    return false;
  }
}

/**
 * The two signals, in the request path.
 *
 * NEW IP — off by default per tenant (`signature_policy.notify_on_scan`). For a
 * tenant issuing hundreds of delivery notes this is noise, and a notification
 * channel that is noise gets muted wholesale, taking the useful ones with it.
 *
 * ANOMALY — more than `scan_anomaly_threshold` (default 25) scans on one
 * signature in a rolling hour, emitted at HIGH and NOT subject to the toggle
 * above. A document verified forty times in an hour is either under audit or
 * being shopped around, and both are worth knowing whichever way the
 * per-scan notification is set.
 */
async function afterScan(client, sig, { isNewIp, via }) {
  if (isNewIp) {
    const notify = await getSetting(client, "signature_policy", "notify_on_scan", false);
    if (notify === true) {
      await emitEvent(client, {
        eventTypeKey: events.SCANNED_NEW_IP,
        moduleKey: events.SIGNATURE_MODULE,
        entityRef: sig.entity_ref,
        actorUserId: null,
        payload: { signature_id: sig.signature_id, doc_type: sig.doc_type, via },
      });
    }
  }

  const threshold = Number(await getSetting(client, "signature_policy", "scan_anomaly_threshold", 25));
  if (!Number.isFinite(threshold) || threshold <= 0) return;
  const inWindow = await sigRepo.countScansInWindow(client, sig.signature_id, 60);
  // `>` and not `>=`: the threshold is the number of scans that are still
  // ordinary, so the alarm belongs on the one after it. Criterion 6 in §5.8
  // reads the limiter the same way.
  if (inWindow > threshold) {
    await emitEvent(client, {
      eventTypeKey: events.SCAN_ANOMALY,
      moduleKey: events.SIGNATURE_MODULE,
      entityRef: sig.entity_ref,
      actorUserId: null,
      priority: "HIGH",
      payload: {
        signature_id: sig.signature_id, doc_type: sig.doc_type,
        scans_in_hour: inWindow, threshold,
      },
    });
  }
}

/**
 * Resolve a verification code to the page behind it.
 *
 * Throws 404 — identically — for a malformed code and for one that has never
 * existed. Everything else returns 200, INCLUDING a revoked signature: someone
 * holding a PDF printed before the revocation must be told plainly that it was
 * withdrawn, not left to conclude the link is merely broken.
 */
async function resolve(client, { code, via = "QR", ip = null, userAgent = null, referrer = null, lang = "fr" }) {
  const language = langOf(lang);

  // Shape first, so junk costs no database round-trip — and so a malformed code
  // and a well-formed unknown one leave by the same door.
  if (!tokens.isValidCode(code)) throw notFound();
  const sig = await sigRepo.getByVerifyCode(client, tokens.normaliseCode(code));
  if (!sig) throw notFound();

  // ── The one live read on this page, and it is not the summary ───────────
  let liveDoc = null;
  try {
    liveDoc = await sigService.loadDoc(client, { docType: sig.doc_type, entityRef: sig.entity_ref });
  } catch { /* @silent:parse — an unloadable record reads UNKNOWN, never AMENDED.
    "We cannot check" and "it changed" are different claims and only one of them
    accuses somebody of something. */ }

  const content = contentVerdict(sig, liveDoc, language);
  const vaulted = await repo.vaultedHash(client, sig.document_vault_id).catch(() => null);
  const artifact = artifactVerdict(sig, vaulted, language);

  const revoked = Boolean(sig.revoked_at);
  const status = revoked ? "REVOKED" : (content.state === "FAIL" ? "AMENDED" : "VALID");

  // Q5 = C — stale AND loud. A stranger scanning an amended document is exactly
  // the moment the tenant should hear about it, so the portal raises the same
  // compliance flag an internal read would. Idempotent and advisory-locked
  // inside the signature service; failures there never reach this response.
  let changes = [];
  if (content.state === "FAIL" && liveDoc) {
    try {
      const current = canonical.canonical(sig.doc_type, liveDoc, sig.payload_version);
      changes = summary.describeChanges(
        canonical.diff(sig.content_payload || {}, current),
        { currency: (sig.content_payload && sig.content_payload.currency) || "", language },
      );
    } catch (err) {
      logger.warn({ err: err && err.message, signature_id: sig.signature_id }, "portal could not diff an amended payload");
    }
    await sigService.onAmendmentDetected(client, sig, liveDoc);
  }

  /*
   * The card the signer actually used, from the SAME catalogue the sender, the
   * signing page and the settings screen render (§3.3, and the MUST in §5.7 —
   * `client/src/features/vault/signature-cards.tsx` renders this on the portal
   * too rather than the portal growing its own grid). A tenant that renames a
   * card renames it here as well, which is the entire reason there is one
   * catalogue and not four copies of a label.
   */
  const preset = sig.preset_code ? await presets.getPreset(client, sig.preset_code).catch(() => null) : null;
  const card = preset
    ? {
      preset_code: preset.preset_code,
      label: language === "en" ? preset.label_en : preset.label_fr,
      blurb: language === "en" ? preset.blurb_en : preset.blurb_fr,
      tier: preset.tier_label || null,
      assurance_level: preset.assurance_level,
      // Same source as the signing menu's cards, so the two surfaces cannot
      // disagree about how an assurance level is worded.
      assurance_words: presets.assuranceWords(preset.assurance_level, language),
      visual_mark: preset.visual_mark,
    }
    : null;

  // ⚠ THE STORED PAYLOAD. Not the live record — see rule 1 in the header.
  // An unregistered doc type returns null and the page shows the verdicts and
  // the signer alone; it never falls back to dumping whatever the payload holds.
  const asSigned = summary.summarise(sig.doc_type, sig.content_payload, language);

  const isNewIp = await logScan(client, sig, { ip, userAgent, referrer, via: viaOf(via) });

  return {
    status,
    language,
    verdicts: [content, artifact],
    signature: {
      verify_code: tokens.formatCode(sig.verify_code),
      doc_type: sig.doc_type,
      signed: signerBlock(sig, language),
      revoked_at: sig.revoked_at,
      revoke_reason: sig.revoke_reason || null,
      // The FIRST 16 hex, labelled — the same fragment the seal prints, so a
      // reader can hold the paper against the screen. §3.12.
      content_hash_short: String(sig.content_hash || "").slice(0, 16),
      card,
    },
    // Null for a doc type with no published summary. The client renders the
    // verdicts and the signer; it must never invent a fallback.
    as_signed: asSigned,
    changes,
    issuer: await repo.legalBlock(client).catch(() => null),
    scan: { is_new_ip: isNewIp, via: viaOf(via) },
  };
}

/*
 * The scan LOG's readers live in document_signature.service, not here: the
 * internal "who scanned this" tab is a MOD-64 view of a signature's own
 * history, and the retention sweep is that data's lifecycle. This module owns
 * the public read and the write that happens during it, and nothing else.
 */
module.exports = { resolve, contentVerdict, artifactVerdict, viaOf, langOf };
