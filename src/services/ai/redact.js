/**
 * PII / financial redaction before any text leaves for an external model or is
 * embedded (PRD §10.5).
 *
 * Audit 3.5: the original three patterns (IBAN, long digit runs, email) missed
 * phone numbers, credit card numbers (with separators), OHADA-zone RIB bank
 * accounts, Cameroon-format NIU tax IDs, and social security numbers. For a
 * system handling OHADA financial data, these are not edge cases.
 *
 * STRATEGY: pattern-based, not NER-based. NER (named entity recognition) for
 * person names would require a model call or a library dependency this layer
 * cannot afford on every egress path. Patterns catch the structured PII that
 * is most likely to appear in ERP data — account numbers, phone numbers, tax
 * IDs, card numbers — while the confidentiality tag system already filters
 * field-level secrets upstream.
 *
 * ORDER MATTERS: more specific patterns must run before general ones. A RIB
 * with spaces would be partially caught by the phone pattern if it ran first.
 */
"use strict";

function redact(text) {
  return String(text || "")
    // ── Structured financial identifiers (most specific first) ──

    // IBAN: 2-letter country code + 2 check digits + 10-30 alphanumeric.
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "[IBAN]")

    // Credit/debit card numbers: 13-19 digits, optionally separated by spaces
    // or dashes in groups of 4. Catches "4111 1111 1111 1111" and
    // "4111-1111-1111-1111" that the old \d{9,} missed.
    .replace(/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,7}\b/g, "[CARD]")
    .replace(/\b\d{4}[\s-]\d{6}[\s-]\d{5}\b/g, "[CARD]")  // Amex format

    // OHADA-zone RIB (Relevé d'Identité Bancaire): 5 digits (bank) + 5 digits
    // (branch) + 12 digits/letters (account) + 2 digits (key), with optional
    // spaces. Common in Cameroon, Gabon, Congo, Senegal, Côte d'Ivoire.
    .replace(/\b\d{5}\s?\d{5}\s?[A-Z0-9]{12}\s?\d{2}\b/gi, "[RIB]")

    // Cameroon NIU (Numéro d'Identifiant Unique): format P000000000000A
    // (letter + 12 digits + letter) or the shorter numeric format.
    .replace(/\b[Pp]\d{12}[A-Za-z]\b/g, "[NIU]")
    .replace(/\b\d{6,8}-[A-Z]-\d{4}\b/g, "[NIU]")  // alternate NIU format

    // ── Phone numbers ──

    // International format: +237 6XX XXX XXX, +1 (555) 123-4567, etc.
    // Requires the + prefix to avoid matching date ranges or page numbers.
    .replace(/\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,4}[\s.-]?\d{0,4}/g, "[PHONE]")

    // Local Cameroon mobile: 6XX XXX XXX or 6XXXXXXXX (9 digits starting with 6).
    // Anchored to avoid matching other 9-digit numbers (those are caught by [NUM]).
    .replace(/\b6\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, "[PHONE]")

    // ── Personal identifiers ──

    // Email addresses.
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]")

    // Social security / CNPS numbers: letter prefix + 8-13 digits.
    // Common formats: CNPS-123456789, SS-12345678, etc.
    .replace(/\b(?:CNPS|SS|SSN|NISS)[\s-]?\d{8,13}\b/gi, "[SSN]")

    // Passport numbers: 1-2 letter prefix + 6-9 digits (many countries).
    .replace(/\b[A-Z]{1,2}\d{6,9}\b/g, "[PASSPORT]")

    // ── Catch-all for long digit runs (accounts, reference numbers) ──
    // 9+ consecutive digits that weren't caught by a more specific pattern above.
    .replace(/\b\d{9,}\b/g, "[NUM]");
}

module.exports = { redact };
