/**
 * Protected terms that MUST survive rewriting and translation byte-for-byte.
 * An LLM "improving" FOB Douala is the class of error that reaches a customs
 * broker and costs money. Enforced mechanically, not requested in a prompt.
 */
"use strict";

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const CONTAINERS = ["20GP", "40GP", "40HC", "40RF", "20RF", "45HC"];
const CURRENCIES = ["XAF", "EUR", "USD", "GBP", "XOF"];

function extraFrom(text) {
  const t = String(text || "");
  const refs = t.match(/[A-Za-z0-9]{2,}-\d{4}-\d{2,}/g) || [];
  const hs = t.match(/\b\d{4,10}\b/g) || [];
  const compte = t.match(/compte\s+\d{3,}/gi) || [];
  return [...refs, ...compte];
}

function termsIn(text) {
  const upper = String(text || "");
  const found = [];
  for (const w of [...INCOTERMS, ...CONTAINERS, ...CURRENCIES]) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(upper)) found.push(w);
  }
  found.push(...extraFrom(text));
  return [...new Set(found)];
}

function restore(original, rewritten) {
  const need = termsIn(original);
  let out = String(rewritten || "");
  const missing = [];
  for (const term of need) {
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(out)) {
      missing.push(term);
      out += (out.endsWith(".") ? " " : " ") + term;
    }
  }
  return { text: out, missing, ok: missing.length === 0 };
}

module.exports = { INCOTERMS, CONTAINERS, CURRENCIES, termsIn, restore };
