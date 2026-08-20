/**
 * PURE: draft + facts → { ok, violations[] }.
 * A date, reference, amount, percentage or time in the draft must appear in
 * the fact list. Fabrications never reach the editor.
 */
"use strict";

const REF = /[A-Za-z0-9]{2,}-\d{4}-\d{2,}/g;
const MONEY = /\b\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d+)?\b|\b\d+[.,]\d{2}\b/g;
const DATE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|févr|avr|mai|juin|juil|août|sept|oct|nov|déc)[a-zéû.]*\s+\d{2,4}\b/gi;
const PCT = /\b\d+(?:[.,]\d+)?\s*%/g;

function tokens(text) {
  const s = String(text || "");
  return [
    ...(s.match(REF) || []),
    ...(s.match(MONEY) || []),
    ...(s.match(DATE) || []),
    ...(s.match(PCT) || []),
  ].map((t) => t.replace(/\s+/g, " ").trim());
}

function fence(draft, facts) {
  const factText = Array.isArray(facts) ? facts.join("\n") : String(facts || "");
  const hay = factText.toLowerCase().replace(/\s+/g, " ");
  const violations = [];
  for (const tok of tokens(draft)) {
    const needle = tok.toLowerCase().replace(/\s+/g, " ");
    if (!hay.includes(needle)) violations.push(tok);
  }
  return { ok: violations.length === 0, violations };
}

module.exports = { fence, tokens };
