/**
 * Signature rows → seal view models (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.12).
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 * `kit.sealBlock()` has existed, tested and documented, since PR-1, and NOTHING
 * CALLED IT. Every rendered document carried the foot's verification QR and no
 * seal, so the one thing a reader actually looks at — *who attested to what, in
 * what capacity, and when* — was never on the page. The guide's own delivery
 * table records the decision to defer it ("the seal needs a placement decision
 * per template inside a hard 34mm budget"); this is the other half.
 *
 * It is a projection, not a policy. Every value below is read off a stored
 * signature row and translated; nothing is decided here, and nothing is looked
 * up that could disagree with what was signed.
 *
 * ── What it deliberately does not carry ────────────────────────────────────
 * No verdict and no IP. `sealBlock` has no parameter for either — §3.12 and
 * §3.13 — and this file must not become the place someone smuggles one in. A
 * static PDF cannot know it is still valid, and the page it prints on travels
 * through a warehouse, a border post and a customer's filing cabinet.
 */
"use strict";

const { getSetting } = require("../../shared/config/settings");
const presets = require("./presets");
const verifyLink = require("./verify-link");
const { logger } = require("../../config/logger");

/** Plain-language assurance. Never `AES_OTP` — a court should not need a glossary. */
const METHOD_WORDS = {
  SES: { fr: "Signé depuis une session authentifiée", en: "Signed from an authenticated session" },
  AES_OTP: { fr: "Vérifié par code e-mail", en: "Verified by email code" },
  QES: { fr: "Certifié par un tiers de confiance", en: "Certified by a trust provider" },
  WET: { fr: "Signé à la main et rapproché", en: "Signed by hand and reconciled" },
};

const lang = (v) => (String(v || "").toLowerCase().startsWith("en") ? "en" : "fr");

/**
 * The signing moment, in the tenant's zone with the zone NAMED.
 *
 * "27 Jul 2026, 14:35" is ambiguous across a border and this document crosses
 * one. Explicit components rather than `dateStyle` — `Intl.DateTimeFormat`
 * throws when `timeZoneName` is combined with a style shorthand, and the
 * certificate shipped with an empty local stamp for exactly that reason
 * (services/signatures/certificate.js carries the same note).
 */
function stampedAt(value, timezone, language) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fr-FR", {
      timeZone: timezone || "UTC",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short",
    }).format(d);
  } catch {
    /* @silent:parse — an unknown tenant timezone must not stop a document
       rendering. The UTC fallback below is less useful and still true. */
    return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

/**
 * Whose side one seal speaks for.
 *
 * INTERNAL is us, so it resolves to the issuing entity's legal name — never to
 * the signer's own name, which is the line below it. EXTERNAL is the
 * counterparty, and the only name we hold for them is the one they declared
 * when they signed (`identity_source = 'DECLARED'`, §3.4: the name is claimed,
 * the email is proved).
 */
function forParty(sig, entity) {
  if (String(sig.party || "INTERNAL").toUpperCase() === "EXTERNAL") {
    return sig.signer_name || sig.signer_email || "";
  }
  return (entity && entity.legal_name) || "";
}

/**
 * Build the seal view models for one document's signatures, oldest first.
 *
 * OLDEST FIRST, against `listByRef`'s newest-first: two seals on a page read as
 * a chain, and a chain that prints "2 of 2" above "1 of 2" is a chain nobody
 * can follow. The position is derived from the printed order for the same
 * reason — it is the reader's index into what is on this page, not a database
 * ordinal that might count a revoked row they cannot see.
 *
 * BEST-EFFORT BY DESIGN. Every failure path returns fewer seals, never throws:
 * a document that cannot render its seal must still render, exactly as it does
 * for a tenant that has never signed anything. The alternative is a signature
 * subsystem that can take an invoice down.
 *
 * @param {object} client       tenant connection
 * @param {object[]} signatures active (non-revoked) rows, newest first
 * @param {object} opts
 * @param {object} opts.entity  the issuing corporate entity
 * @param {string} opts.docRef  the document's own number, printed as evidence
 * @param {string} opts.language 'fr' | 'en'
 * @param {string} [opts.origin] host the QR should resolve on
 * @returns {Promise<object[]>} inputs for kit.sealBlock, in print order
 */
async function build(client, signatures, { entity = {}, docRef = "", language = "fr", origin = null } = {}) {
  const rows = (Array.isArray(signatures) ? signatures : []).filter((r) => r && !r.revoked_at);
  if (!rows.length) return [];
  const L = lang(language);

  const [timezone, reasons] = await Promise.all([
    getSetting(client, "locale", "timezone", "Africa/Douala").catch(() => "Africa/Douala"),
    presets.reasons(client).catch(() => []),
  ]);
  // The tenant's own wording for the attestation, by code. A tenant that
  // renamed "Goods received" sees the rename here too — it is one vocabulary,
  // and the seal is the surface it exists for.
  const reasonWords = new Map(rows.length
    ? reasons.map((r) => [r.reason_code, L === "en" ? r.label_en : r.label_fr])
    : []);

  const ordered = rows.slice().sort((a, b) => new Date(a.signed_at) - new Date(b.signed_at));
  const out = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const sig = ordered[i];
    let verify = null;
    try {
      verify = await verifyLink.verifyContext(client, { code: sig.verify_code, origin, sizeMm: 22 });
    } catch (err) {
      logger.warn({ err: err && err.message, signature_id: sig.signature_id }, "seal QR could not be rendered");
    }
    // No QR means no seal. A seal is a claim that the document can be checked
    // independently; printing one with nothing to check against teaches readers
    // that our marks are decorative, which costs more than the blank space.
    if (!verify) continue;
    out.push({
      forParty: forParty(sig, entity),
      position: { n: i + 1, of: ordered.length },
      reason: reasonWords.get(sig.sign_reason) || "",
      signerName: sig.signer_name || "",
      signerRole: sig.signer_role || "",
      signedAt: stampedAt(sig.signed_at, timezone, L),
      method: (METHOD_WORDS[sig.assurance_level] || METHOD_WORDS.SES)[L],
      docRef,
      contentHash: sig.content_hash || "",
      code: verify.code,
      qrSvg: verify.qrSvg,
      // DRAWN only. A stamp has no image, and `sealBlock` chooses its layout
      // from the presence of this field.
      markImageB64: sig.visual_mark === "DRAWN" ? sig.mark_image_b64 || null : null,
    });
  }
  return out;
}

module.exports = { build, stampedAt, forParty, METHOD_WORDS };
