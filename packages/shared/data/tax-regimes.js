"use strict";
/**
 * Tax regimes — the ONE definition of what regime values exist.
 *
 * WHY HERE. Three consumers need the identical list and cannot drift:
 *   - the API's Zod schema (entity-common.js) validates regime against it,
 *   - the migration that seeds CHECK constraint (generated FROM this file),
 *   - the client's RegimePicker which imports it directly so the list renders
 *     with no round-trip and stays in sync with the backend.
 *
 * Cameroon (OHADA/CEMAC) regimes (OHADA_KB §14):
 *   - REEL: Actual earnings (régime du réel) ≥50M XAF, VAT-registered, full OHADA books
 *   - SIMPLIFIE: Simplified (simplifié) 10M-50M, minimum tax 5.5%
 *   - LIBERATOIRE: Flat-rate (impôt libératoire) <10M, micro
 *   - FRANCHISE: VAT franchise / exemption — charges no VAT (costing uses this)
 *   - NORMAL: French/EU \"régime normal\" — kept for compatibility with migration 0516 comment
 *   - FORFAIT: Forfaitaire / lump-sum (alias for LIBERATOIRE in some jurisdictions)
 *
 * The list is ordered by turnover descending, so REEL leads for a Douala forwarder.
 */

const TAX_REGIMES = [
  {
    code: "REEL",
    label_fr: "Réel",
    label_en: "Actual earnings",
    hint_fr: "≥50M XAF — assujetti TVA, comptabilité OHADA complète",
    hint_en: "≥50M XAF — VAT-registered, full OHADA books",
  },
  {
    code: "NORMAL",
    label_fr: "Normal",
    label_en: "Normal",
    hint_fr: "Régime normal (France/UE) — équivalent réel",
    hint_en: "Normal regime (France/EU) — equivalent to REEL",
  },
  {
    code: "SIMPLIFIE",
    label_fr: "Simplifié",
    label_en: "Simplified",
    hint_fr: "10M-50M XAF — impôt minimum 5,5%",
    hint_en: "10M-50M XAF — minimum tax 5.5%",
  },
  {
    code: "LIBERATOIRE",
    label_fr: "Libératoire",
    label_en: "Flat-rate",
    hint_fr: "<10M XAF — micro, impôt libératoire",
    hint_en: "<10M XAF — micro, flat-rate tax",
  },
  {
    code: "FORFAIT",
    label_fr: "Forfaitaire",
    label_en: "Lump-sum",
    hint_fr: "Forfait — variante libératoire",
    hint_en: "Lump-sum — variant of flat-rate",
  },
  {
    code: "FRANCHISE",
    label_fr: "Franchise TVA",
    label_en: "VAT-exempt",
    hint_fr: "Franchise en base — pas de TVA facturée",
    hint_en: "VAT franchise — charges no VAT",
  },
];

const CODES = TAX_REGIMES.map((r) => r.code);

function byCode(code) {
  const c = String(code || "").trim().toUpperCase();
  return TAX_REGIMES.find((r) => r.code === c) || null;
}

function labelFor(code, lang = "en") {
  const r = byCode(code);
  if (!r) return code || "";
  return lang === "fr" ? r.label_fr : r.label_en;
}

function hintFor(code, lang = "en") {
  const r = byCode(code);
  if (!r) return "";
  return lang === "fr" ? r.hint_fr : r.hint_en;
}

exports.TAX_REGIMES = TAX_REGIMES;
exports.TAX_REGIME_CODES = CODES;
exports.byCode = byCode;
exports.labelFor = labelFor;
exports.hintFor = hintFor;
