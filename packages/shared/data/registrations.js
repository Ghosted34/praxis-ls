"use strict";
/**
 * expectedRegistrations — the ONE definition of "which tax/legal IDs a
 * counterparty is expected to have", shared by the create/edit form (which
 * renders a field per requirement) and the backend validator (which enforces
 * the same set), so the UI and the API cannot drift (PR3 §2.2, the project's
 * "one definition of valid" principle).
 *
 * The expected set is the UNION of:
 *   - the country's statutory requirements (`country_profile.registration_
 *     requirements`, sourced from data/countries.js) — e.g. CM ⇒ NIU + RCCM,
 *     an EU state ⇒ VAT (+ EORI), the US ⇒ EIN;
 *   - the IDs implied by the party's ROLE and CATEGORY — e.g. a customs broker
 *     clears cargo across borders and needs an EORI economic-operator number.
 *
 * A category can only ADD an expected ID or promote one to required; it can
 * never remove a country-mandated one (PR3 §2.1). `required` on a merged entry
 * is therefore the OR of the two sources.
 *
 * Shape of each entry mirrors the country requirement:
 *   { kind, label_fr, label_en, regex, placeholder, required, source }
 * `source` is "country" | "category" | "both", carried for the UI/validator to
 * explain WHY a field is shown; it never affects validity.
 */
const { requirementsFor, EU } = require("./countries");

/** An EORI economic-operator id — needed to move goods across an EU/customs
 *  border. Reused by the customs-broker rule and the EU-supplier rule. */
const EORI = {
  kind: "EORI",
  label_fr: "Numéro EORI",
  label_en: "EORI number",
  regex: "^[A-Za-z]{2}[A-Za-z0-9]{1,15}$",
  placeholder: "FR123456789012345",
  required: true,
};

const EU_SET = new Set(EU);

/**
 * The registration requirements implied by a party's role/category, independent
 * of country. Keyed by category CODE (client_type.code / supplier_type.code).
 * Kept deliberately small and explicit — this is regulation, not guesswork.
 */
function categoryRequirements({ kind, category, country }) {
  const out = [];
  const cat = String(category || "").toUpperCase();
  // A customs broker (supplier) is an authorised economic operator: EORI.
  if (kind === "supplier" && cat === "CUSTOMS_BROKER") out.push(EORI);
  // An EU-domiciled supplier trading with us needs an EORI to clear customs.
  if (kind === "supplier" && EU_SET.has(String(country || "").toUpperCase()))
    out.push(EORI);
  return out;
}

/** Merge `extra` into `base` by `kind`, OR-ing `required` and marking source. */
function mergeByKind(base, extra) {
  const byKind = new Map(
    base.map((r) => [r.kind, { ...r, source: "country" }]),
  );
  for (const r of extra) {
    const existing = byKind.get(r.kind);
    if (existing) {
      byKind.set(r.kind, {
        ...existing,
        required: !!existing.required || !!r.required,
        source: "both",
      });
    } else {
      byKind.set(r.kind, { ...r, source: "category" });
    }
  }
  return [...byKind.values()];
}

/**
 * The full set of registration IDs expected for a party.
 *
 * @param {object} opts
 * @param {string} opts.country  ISO-3166-1 alpha-2 country code (the party's).
 * @param {string} opts.kind     "client" | "supplier".
 * @param {string} [opts.category] category code (client_type/supplier_type code).
 * @returns {Array<{kind,label_fr,label_en,regex,placeholder,required,source}>}
 *
 * `docTypes` is accepted in the options object for forward-compatibility with
 * document-driven implications but is not consumed today; extra keys are
 * ignored, so callers may pass the richer object the form already has.
 */
function expectedRegistrations(opts = {}) {
  const { country, kind, category } = opts;
  const base = requirementsFor(country); // [] for a country with no defined profile
  const extra = categoryRequirements({ kind, category, country });
  if (extra.length === 0) return base.map((r) => ({ ...r, source: "country" }));
  return mergeByKind(base, extra);
}

/** The `kind`s (NIU, VAT, EORI, …) expected, as a plain sorted array — the form
 *  the backend validator compares a submitted registration set against. */
function expectedKinds(opts = {}) {
  return expectedRegistrations(opts)
    .map((r) => r.kind)
    .sort();
}

// Named `exports.x =` assignments, NOT `module.exports = { x }` — the client is
// bundled and cjs-module-lexer cannot see named exports through an object
// literal. See index.js.
exports.EORI = EORI;
exports.expectedRegistrations = expectedRegistrations;
exports.expectedKinds = expectedKinds;
