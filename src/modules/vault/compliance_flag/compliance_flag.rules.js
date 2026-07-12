/**
 * Compliance Checker (MOD-65) — pure rule catalogue + summariser. The actual data
 * scans live in the repo; this declares each rule's key, severity and human
 * description, and rolls a set of flags into a summary by severity.
 */
"use strict";

const CATALOGUE = {
  "cost_entry.missing_proof": { severity: "WARN", describe: "A dossier cost entry has no proof document attached (KB §6 compliance)." },
  "procurement.unmatched": { severity: "WARN", describe: "A posted supplier invoice has no matched goods-received note (three-way match)." },
  "regie.aged_unjustified": { severity: "RED", describe: "A régie d'avance is aged and unjustified (581 unresolved)." },
  "debours.tax_violation": { severity: "RED", describe: "A débours journal line carries a tax code — débours must be tax-free (KB §23.5)." },
};

const ruleKeys = () => Object.keys(CATALOGUE);
const severityOf = (ruleKey) => (CATALOGUE[ruleKey] ? CATALOGUE[ruleKey].severity : "WARN");
const describeOf = (ruleKey) => (CATALOGUE[ruleKey] ? CATALOGUE[ruleKey].describe : null);

function summarize(flags) {
  const by = { INFO: 0, WARN: 0, RED: 0 };
  for (const f of flags) by[f.severity] = (by[f.severity] || 0) + 1;
  return { total: flags.length, red: by.RED, warn: by.WARN, info: by.INFO, clean: flags.length === 0 };
}

module.exports = { CATALOGUE, ruleKeys, severityOf, describeOf, summarize };
