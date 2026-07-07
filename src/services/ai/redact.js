/**
 * PII / financial redaction before any text leaves for an external model or is
 * embedded (PRD §10.5). Coarse but safe: mask long digit runs (accounts/phones),
 * emails, and IBAN-like tokens. Field-level secrets are already filtered upstream
 * by confidentiality tags.
 */
"use strict";

function redact(text) {
  return String(text || "")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, "[IBAN]")
    .replace(/\b\d{9,}\b/g, "[NUM]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
}

module.exports = { redact };
