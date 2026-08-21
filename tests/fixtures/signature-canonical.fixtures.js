/**
 * Frozen inputs for the canonical-payload golden-digest test.
 *
 * ⚠ NEVER EDIT A FIXTURE to make a failing test pass. The digest changing is the
 *   test doing its job: it means a payload builder changed shape, and every
 *   signature ever issued against that doc type has just stopped verifying.
 *   See tests/unit/signature-canonical.test.js for what to do instead.
 *
 * Values are deliberately awkward — trailing-decimal money, three-decimal
 * quantities, accented text, an empty line array — because the rounding and
 * string coercion in canonical.js are part of the hashed contract, and a
 * fixture of round numbers would not exercise them.
 */
"use strict";

const party = { name: "CIMENCAM SA", lines: ["Douala, Cameroun", "NIU P012345678"] };
const priceLines = [
  { label: "Transit maritime — conteneur 40'", qty: 2, unit: 450000, tax: 19.25, amount: 900000 },
  { label: "Manutention portuaire", qty: 1.005, unit: 180000.004, tax: 19.25, amount: 180900.5 },
];
const totals = { service_ht: 1080900.5, disbursement_total: 320000, vat_total: 207900.25, total_ttc: 1608800.75 };

module.exports = {
  FINAL_INVOICE: {
    number: "FCT-2026-0001", date: "2026-07-27", due: "2026-08-26",
    dossier_ref: "SBX-2026-0001", currency: "XAF", party, lines: priceLines, totals,
  },
  PROFORMA_ADVANCE: {
    number: "PRO-2026-0007", date: "2026-07-27", dossier_ref: "SBX-2026-0001",
    currency: "XAF", party, lines: priceLines, totals,
  },
  QUOTATION: {
    number: "DEV-2026-0012", date: "2026-07-27", valid_until: "2026-08-27",
    currency: "XAF", party, lines: priceLines, totals,
  },
  PROPOSAL: {
    number: "PROP-2026-0003", revision: 2, date: "2026-07-27", valid_until: "2026-09-30",
    currency: "XAF", party, lines: priceLines, totals,
  },
  PURCHASE_ORDER: {
    number: "BC-2026-0044", date: "2026-07-27", currency: "XAF",
    party: { name: "Fournisseur Général SARL", lines: ["Yaoundé"] }, lines: priceLines, totals,
  },
  DELIVERY_NOTE: {
    number: "BL-2026-0231", date: "2026-08-20", dossier_ref: "SBX-2026-0001", party,
    vehicle: "LT-8842-AB", driver: "Ibrahim Nsangou",
    lines: [
      { label: "Ciment 42.5 — sacs 50kg", qty: 400, unit_of_measure: "sac" },
      { label: "Palettes consignées", qty: 12.5, unit_of_measure: "u" },
    ],
    reserves: "2 palettes endommagées à la réception",
  },
  TRANSIT_ORDER: {
    number: "OT-2026-0099", date: "2026-08-20", dossier_ref: "SBX-2026-0001", party,
    origin: "Port de Douala", destination: "Ngaoundéré", vehicle: "LT-8842-AB",
    lines: [{ label: "Conteneur 40' DRY", qty: 1, unit_of_measure: "TC" }],
  },
  EMPLOYMENT_CONTRACT: {
    number: "CT-2026-0018", date: "2026-08-01", employee: "Jean Mbarga",
    job_title: "Commercial Director", contract_type: "CDI",
    start_date: "2026-09-01", end_date: "", currency: "XAF",
    gross_salary: 1250000.004, trial_period_months: 3,
    clauses: [{ heading: "Confidentialité" }, { heading: "Non-concurrence" }, "Clause de mobilité"],
  },
};
