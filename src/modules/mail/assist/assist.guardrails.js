/**
 * PURE pre-send checks. Warnings are dismissible. One hard block: a financial
 * document to a domain rated Suspicious or Likely impersonation.
 */
"use strict";

const ATTACH_RE = /attach(?:ed|ment)|ci-joint|pièce jointe|please find|veuillez trouver/i;
const PLACEHOLDER = /\[amount\]|\bXXX\b|\bTBD\b|<name>|lorem/i;
const BANK_CHANGE = /new bank details|nouvelles coordonn[eé]es bancaires|updated remittance|iban|account number/i;
const FINANCIAL_DOC = /invoice|proforma|statement|relev[eé]|facture|bank details|coordonn[eé]es bancaires/i;

function check(message = {}, ctx = {}) {
  const warnings = [];
  const blocks = [];
  const body = String(message.html || message.text || "");
  const subject = String(message.subject || "");
  const to = [].concat(message.to || []);
  const attachments = message.attachments || [];

  if (ATTACH_RE.test(body) && attachments.length === 0) {
    warnings.push({ code: "MISSING_ATTACHMENT", message: "The body says something is attached, but nothing is." });
  }
  if (!subject.trim()) warnings.push({ code: "NO_SUBJECT", message: "This message has no subject." });
  if (PLACEHOLDER.test(body) || PLACEHOLDER.test(subject)) {
    warnings.push({ code: "PLACEHOLDER", message: "Unresolved placeholder in the draft." });
  }
  if (to.length > 10) warnings.push({ code: "REPLY_ALL_WIDTH", message: "More than 10 recipients on this send." });
  if (ctx.preferredLanguage && ctx.draftLanguage && ctx.preferredLanguage !== ctx.draftLanguage) {
    warnings.push({ code: "LANGUAGE_MISMATCH", message: `Drafting in ${ctx.draftLanguage} to a party whose preferred language is ${ctx.preferredLanguage}.` });
  }
  if (Number(message.htmlBytes || 0) > 102 * 1024) {
    warnings.push({ code: "OVERSIZED_HTML", message: "Body is over 102 KB — Gmail will clip it." });
  }

  const verdict = ctx.authVerdict || "VERIFIED";
  const financial = FINANCIAL_DOC.test(body) || FINANCIAL_DOC.test(subject) || attachments.some((a) => FINANCIAL_DOC.test(a.filename || ""));
  if (financial && (verdict === "SUSPICIOUS" || verdict === "LIKELY_IMPERSONATION")) {
    blocks.push({
      code: "FINANCIAL_TO_SUSPICIOUS",
      message: "A financial document to a domain that is not verified. Type a reason to override; the reason is written to the immutable ledger.",
    });
  }
  if (BANK_CHANGE.test(body) && verdict !== "VERIFIED") {
    warnings.push({ code: "BANK_CHANGE", message: "This looks like a bank-detail change from an unverified sender." });
  }

  return { warnings, blocks };
}

module.exports = { check };
