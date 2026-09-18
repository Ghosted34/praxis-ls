/**
 * PII / financial scrubbing before text leaves for a model or is embedded
 * (PRD §10.5, doc/AI_ARCHITECTURE.md §6).
 *
 * ── TWO EGRESS CLASSES, NOT ONE (audit A1 / F3) ─────────────────────────────
 *
 * There used to be a single `redact()` applied to everything, and its catch-all
 * `\b\d{9,}\b → [NUM]` hid EVERY number of nine digits or more from the model —
 * which in XAF is every amount from one hundred million up, an ordinary figure
 * for a logistics forwarder. The passport rule `\b[A-Z]{1,2}\d{6,9}\b` ate
 * ordinary ERP references (`AB1234567`) on the way past. The model was then
 * asked "what is our largest receivable" over a context reading `[NUM]`, and it
 * either refused or invented a plausible number. That was the leading
 * hypothesis for the inaccuracy the review reported, and it is what this file
 * exists to undo.
 *
 * The fix is to stop pretending the two things are the same egress:
 *
 *   redactForReasoning()  the caller's OWN authorised data, going into a prompt
 *                         and nowhere else. The caller is authenticated, their
 *                         RBAC decided which tools ran, and retrieval already
 *                         filtered the corpus by confidentiality tag
 *                         (retrieval.service.js). Used for tool results, the
 *                         tenant context block, replayed history and the live
 *                         question.
 *
 *   redactExternal()      text that is PERSISTED, INDEXED or becomes
 *                         client-facing copy: the conversation summariser (its
 *                         output is stored and replayed), the embeddings vendor
 *                         (which sees every chunk of the corpus), and the
 *                         proposal generator (whose output is sent to a client).
 *
 * `redact` stays exported as an alias of `redactExternal`, so the strict path is
 * what any caller that has not thought about the question gets.
 *
 * ── WHAT THE TWO SHARE ──────────────────────────────────────────────────────
 *
 * Payment instruments (IBAN, OHADA RIB, card PAN) and individual government
 * identity numbers (CNPS/SSN, passport) are masked on EVERY path. They are high
 * harm if they leak and they are never the answer to a question — the ERP pays
 * from a stored record; it does not need a model to recite the digits.
 *
 * ── WHAT ONLY THE EXTERNAL PATH MASKS ───────────────────────────────────────
 *
 * Contact data (email, phone) and the tax ID (NIU). "What is the contact email
 * for this client" is core CRM function and was answered with `[EMAIL]`; on the
 * reasoning path those now arrive intact. Signed off 2026-09-18 — see
 * doc/PRAXIS_AI_AUDIT.md §0.
 *
 * ── NUMBERS ARE HANDLED STRUCTURALLY, NOT BY LENGTH ─────────────────────────
 *
 * A digit run is masked because of what SURROUNDS it, not because it is long:
 * an account label in front of it, or a run so long (13+) that no plausible
 * figure reaches it. Nine to twelve bare digits is an amount here, and it
 * survives on both paths — including in the rolling summary, whose `FIGURES`
 * heading asks for numbers "copied EXACTLY" and was being handed `[NUM]`.
 *
 * STRATEGY: pattern-based, not NER-based. NER for person names would need a
 * model call or a library dependency this layer cannot afford on every egress.
 * Patterns catch the structured PII that actually appears in ERP data, while
 * the confidentiality tag system filters field-level secrets upstream.
 *
 * ORDER MATTERS: more specific patterns must run before general ones. A RIB
 * with spaces would be partially caught by the phone pattern if it ran first.
 */
"use strict";

// Currency tokens that mark a digit run as money rather than an identifier.
// Used as a guard on the bare Cameroon-mobile pattern, which is otherwise
// shape-identical to a nine-figure XAF amount ("600 000 000").
const CURRENCY = "XAF|FCFA|F\\s?CFA|XOF|CFA|EUR|USD|GBP|€|\\$|£";

// ── Structured financial identifiers (most specific first) ──

// IBAN: 2-letter country code + 2 check digits + 10-30 alphanumeric.
// Allows single spaces between groups, as IBANs/BBANs are often printed
// spaced (e.g. Cameroon "CM21 10003 00001 00200456789 41"). The uppercase
// char class means trailing lowercase words won't be swallowed.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/g;

// Credit/debit card numbers: 13-19 digits, optionally separated by spaces
// or dashes in groups of 4. Catches "4111 1111 1111 1111" and
// "4111-1111-1111-1111". The leading \d{4} means a thousands-grouped amount
// ("1 250 000 000") cannot match — its first group is shorter.
const CARD = /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,7}\b/g;
const CARD_AMEX = /\b\d{4}[\s-]\d{6}[\s-]\d{5}\b/g;

// OHADA-zone RIB (Relevé d'Identité Bancaire): 5 digits (bank) + 5 digits
// (branch) + 12 digits/letters (account) + 2 digits (key), with optional
// spaces. Common in Cameroon, Gabon, Congo, Senegal, Côte d'Ivoire.
const RIB = /\b\d{5}\s?\d{5}\s?[A-Z0-9]{12}\s?\d{2}\b/gi;

// ── Tax identity (external egress only) ──

// Cameroon NIU (Numéro d'Identifiant Unique): format P000000000000A
// (letter + 12 digits + letter) or the shorter numeric format.
const NIU = /\b[Pp]\d{12}[A-Za-z]\b/g;
const NIU_ALT = /\b\d{6,8}-[A-Z]-\d{4}\b/g;

// ── Phone numbers (external egress only) ──

// International format: +237 6XX XXX XXX, +1 (555) 123-4567, etc.
// Requires the + prefix, so no amount can match it.
const PHONE_INTL = /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{0,4}/g;

// Local Cameroon mobile: 6XX XXX XXX or 6XXXXXXXX (9 digits starting with 6).
//
// This shape is indistinguishable from a nine-figure XAF amount, and it used to
// not matter because the `\d{9,}` catch-all blacked out both. Now that amounts
// survive, the pattern is guarded: a run with a currency token on either side is
// money, not a number anyone can call.
const PHONE_CM = new RegExp(
  `(?<!(?:${CURRENCY})[\\s]{0,3})\\b6\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b(?![\\s]{0,3}(?:${CURRENCY}))`,
  "gi",
);

// ── Personal identifiers ──

// Email addresses (external egress only).
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Social security / CNPS numbers: letter prefix + 8-13 digits.
// Common formats: CNPS-123456789, SS-12345678, etc.
const SSN = /\b(?:CNPS|SS|SSN|NISS)[\s-]?\d{8,13}\b/gi;

// Passport numbers — ANCHORED TO A PASSPORT CONTEXT (audit A1).
//
// The bare shape `[A-Z]{1,2}\d{6,9}` is also the shape of half the reference
// numbers in this ERP (`AB1234567`), and an unanchored rule turned every one of
// them into `[PASSPORT]` before the model ever saw it. A passport number is only
// recognised when something nearby says that is what it is — in either order,
// because documents write it both ways.
const PASSPORT_LABELLED =
  /\b(passports?|passeports?|travel\s+document|document\s+de\s+voyage)\b([^\n]{0,24}?)\b([A-Z]{1,2}\d{6,9})\b/gi;
const PASSPORT_TRAILING =
  /\b[A-Z]{1,2}\d{6,9}\b(?=[^\n]{0,24}?\b(?:passports?|passeports?)\b)/gi;

// ── Account numbers ──
//
// Label-anchored, not length-anchored: an account/compte/IBAN/RIB label, an
// optional "number"/"n°"/":" connective, then the digits. The label is kept and
// only the run is masked, so the sentence still reads. "GL account 401100
// balance 250000000" does not match — the digits do not follow the connective.
const ACCOUNT_NUM =
  /\b((?:bank\s+)?(?:accounts?|acct|a\/c|comptes?|iban|rib)\b[ \t]*(?:number|numbers|no\.?|n[°º]|num[ée]ro|#)?[ \t]*[:#=-]?[ \t]*)(\d{8,})\b/gi;

// Bare digit runs long enough that no plausible figure reaches them. Thirteen
// digits is a trillion XAF; below that a bare run in this ERP is a figure or a
// reference, and it stays.
const LONG_RUN = /\b\d{13,}\b/g;

/**
 * @param {string}  text
 * @param {boolean} contact  also mask contact data and the tax ID (external egress).
 */
function scrub(text, contact) {
  let s = String(text || "");

  s = s.replace(IBAN, "[IBAN]");
  s = s.replace(CARD, "[CARD]").replace(CARD_AMEX, "[CARD]");
  s = s.replace(RIB, "[RIB]");

  if (contact) {
    s = s.replace(NIU, "[NIU]").replace(NIU_ALT, "[NIU]");
    s = s.replace(PHONE_INTL, "[PHONE]");
    s = s.replace(PHONE_CM, "[PHONE]");
    s = s.replace(EMAIL, "[EMAIL]");
  }

  s = s.replace(SSN, "[SSN]");
  s = s
    .replace(PASSPORT_LABELLED, (_m, label, gap) => `${label}${gap}[PASSPORT]`)
    .replace(PASSPORT_TRAILING, "[PASSPORT]");

  s = s.replace(ACCOUNT_NUM, "$1[NUM]");
  s = s.replace(LONG_RUN, "[NUM]");

  return s;
}

/**
 * STRICT. For text that is persisted, indexed, or becomes client-facing copy —
 * the summariser, the embeddings vendor, the proposal generator. Masks contact
 * data and the tax ID on top of the shared set.
 */
function redactExternal(text) {
  return scrub(text, true);
}

/**
 * For the caller's own authorised data on its way into a prompt and nowhere
 * else. Keeps amounts, ERP references, contact data and the tax ID intact;
 * still masks payment instruments and individual government identity numbers.
 */
function redactForReasoning(text) {
  return scrub(text, false);
}

module.exports = {
  redactExternal,
  redactForReasoning,
  // Back-compat: an unqualified `redact` is the strict one, so a caller that has
  // not thought about which egress class it is in gets the safe answer.
  redact: redactExternal,
};
