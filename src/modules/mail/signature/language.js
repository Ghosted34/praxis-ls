/**
 * Outbound language resolution — ONE function.
 *
 * Three language axes exist in this product and they must not be conflated
 * (engineering guide §3.9):
 *
 *   1. UI language        — the operator's own preference.
 *   2. Recipient language — party.preferred_language (this file).
 *   3. Message language   — detected per inbound message.
 *
 * Signatures, templates and (in PR-4) AI translation all call this. Three
 * copies of the rule is how a French client starts receiving English invoices.
 *
 * PURE. No I/O.
 */
"use strict";

const SUPPORTED = new Set(["en", "fr"]);

function asLang(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().slice(0, 2);
  return SUPPORTED.has(s) ? s : null;
}

/**
 * Resolution order, stated so a reviewer can check it against the guide:
 *
 *   1. explicit choice in the composer
 *   2. the bound party's preferred_language
 *   3. language of the message being replied to
 *   4. the sender's own UI language
 *   5. tenant default (falls to 'en')
 *
 * @param {object} ctx
 * @param {string} [ctx.explicit]
 * @param {string} [ctx.partyLanguage]
 * @param {string} [ctx.repliedMessageLanguage]
 * @param {string} [ctx.senderUiLanguage]
 * @param {string} [ctx.tenantDefault]
 * @returns {'en'|'fr'}
 */
function resolveLanguage(ctx = {}) {
  return (
    asLang(ctx.explicit)
    || asLang(ctx.partyLanguage)
    || asLang(ctx.repliedMessageLanguage)
    || asLang(ctx.senderUiLanguage)
    || asLang(ctx.tenantDefault)
    || "en"
  );
}

module.exports = { resolveLanguage, asLang, SUPPORTED };
