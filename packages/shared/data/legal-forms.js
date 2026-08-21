"use strict";
/**
 * Global legal-form catalogue: ISO 20275/GLEIF v1.6 plus the verified OHADA
 * Phase-1 supplement.
 *
 * WHY TWO SOURCES. ISO 20275 is the only maintained global identifier system for
 * entity legal forms and gives us 3,446 active codes, including Germany's GmbH
 * and 729 US federal/state forms. Its own publisher explicitly calls worldwide
 * identification a work in progress, however, and v1.6 contains no Cameroon
 * rows. OHADA law is directly applicable in 17 African states, so its commercial
 * and cooperative forms are added for every member instead of leaving Cameroon
 * with an empty picker or inventing a generic "limited company".
 *
 * The picker saves BOTH the printable value (`abbreviation`) and this reference's
 * code/source/jurisdiction. Existing entities that only hold `legal_form: SARL`
 * remain readable through `matchStored`; every new selection is unambiguous.
 */
const countries = require("./countries");
const generated = require("./legal-forms.generated");

const SOURCE_ISO = "GLEIF_ISO_20275";
const SOURCE_OHADA = "OHADA";

const OHADA_SOURCE_URL =
  "https://www.ohada.org/en/commercial-companies-and-economic-interest-groups/";
const OHADA_COOPERATIVE_SOURCE_URL =
  "https://www.ohada.org/en/cooperative-societies-law/";
const OHADA_VERSION = "AUSCGIE-2014/AUSCOOP-2010";

/** Current OHADA members, from OHADA's own general overview. */
const OHADA_MEMBERS = [
  "BJ",
  "BF",
  "CM",
  "CF",
  "KM",
  "CG",
  "CI",
  "GA",
  "GN",
  "GW",
  "GQ",
  "ML",
  "NE",
  "CD",
  "SN",
  "TD",
  "TG",
];

/**
 * Forms common to the OHADA area.
 *
 * Single-member forms are explicit choices because SARLU/SASU/SAU are what
 * registries and letterheads print, even though the Uniform Act defines each as
 * the single-member variant of SARL/SAS/SA. SEP, branches and representative
 * offices are labelled as non-separate persons so the picker never implies that
 * selecting one creates legal personality.
 */
const OHADA_FORMS = [
  {
    code: "EI",
    name: "Entreprise individuelle / Établissement",
    abbreviation: "EI",
    aliases: [
      "ETS",
      "Entreprise individuelle",
      "Établissement",
      "Commerçant individuel",
    ],
    kind: "REGISTERED_BUSINESS",
  },
  {
    code: "SNC",
    name: "Société en Nom Collectif",
    abbreviation: "SNC",
    aliases: ["Société en nom collectif", "General partnership"],
  },
  {
    code: "SCS",
    name: "Société en Commandite Simple",
    abbreviation: "SCS",
    aliases: ["Société en commandite simple", "Limited partnership"],
  },
  {
    code: "SARL",
    name: "Société à Responsabilité Limitée",
    abbreviation: "SARL",
    aliases: ["Société à responsabilité limitée", "Limited liability company"],
  },
  {
    code: "SARLU",
    name: "Société à Responsabilité Limitée Unipersonnelle",
    abbreviation: "SARLU",
    aliases: ["SARL-U", "SUARL", "SARL unipersonnelle", "Single-member SARL"],
  },
  {
    code: "SA",
    name: "Société Anonyme",
    abbreviation: "SA",
    aliases: ["S.A.", "Société anonyme", "Public limited company"],
  },
  {
    code: "SAU",
    name: "Société Anonyme Unipersonnelle",
    abbreviation: "SAU",
    aliases: ["SA-U", "SA unipersonnelle", "Single-member SA"],
  },
  {
    code: "SAS",
    name: "Société par Actions Simplifiée",
    abbreviation: "SAS",
    aliases: [
      "S.A.S.",
      "Société par actions simplifiée",
      "Simplified joint-stock company",
    ],
  },
  {
    code: "SASU",
    name: "Société par Actions Simplifiée Unipersonnelle",
    abbreviation: "SASU",
    aliases: ["SAS-U", "SAS unipersonnelle", "Single-member SAS"],
  },
  {
    code: "SEP",
    name: "Société en Participation",
    abbreviation: "SEP",
    aliases: ["SP", "Société en participation", "Unregistered joint venture"],
    kind: "UNINCORPORATED",
  },
  {
    code: "GIE",
    name: "Groupement d’Intérêt Économique",
    abbreviation: "GIE",
    aliases: [
      "G.I.E.",
      "Groupement d'intérêt économique",
      "Economic interest grouping",
    ],
  },
  {
    code: "SCOOPS",
    name: "Société Coopérative Simplifiée",
    abbreviation: "SCOOPS",
    aliases: ["SCOOP-S", "Société coopérative simplifiée"],
    cooperative: true,
  },
  {
    code: "COOP-CA",
    name: "Société Coopérative avec Conseil d’Administration",
    abbreviation: "COOP-CA",
    aliases: ["COOPCA", "Société coopérative avec conseil d'administration"],
    cooperative: true,
  },
  {
    code: "SUCCURSALE",
    name: "Succursale",
    abbreviation: "Succursale",
    aliases: ["Branch", "Branch office"],
    kind: "ESTABLISHMENT",
  },
  {
    code: "BUREAU-REP",
    name: "Bureau de liaison ou de représentation",
    abbreviation: "Bureau de représentation",
    aliases: ["Bureau de liaison", "Representative office", "Liaison office"],
    kind: "ESTABLISHMENT",
  },
];

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const countryName = (code) => (countries.byCode(code) || {}).name || code;

const isoForms = generated.GLEIF_FORMS.map(
  ([
    code,
    country_code,
    subdivision_code,
    jurisdiction_name,
    name,
    abbreviation,
    aliases,
  ]) => ({
    key: `${SOURCE_ISO}:${code}`,
    code,
    source: SOURCE_ISO,
    source_version: generated.GLEIF_VERSION,
    source_url: generated.GLEIF_SOURCE_URL,
    country_code,
    country_name: countryName(country_code),
    jurisdiction_code: subdivision_code || country_code,
    jurisdiction_name: jurisdiction_name || countryName(country_code),
    name,
    abbreviation,
    aliases,
    kind: "LEGAL_ENTITY",
  }),
);

/** Does an ISO row already represent this OHADA form? */
function sameForm(existing, supplement) {
  const have = new Set(
    [existing.name, existing.abbreviation, ...(existing.aliases || [])].map(
      normalize,
    ),
  );
  return [
    supplement.name,
    supplement.abbreviation,
    ...(supplement.aliases || []),
  ]
    .map(normalize)
    .some((value) => value && have.has(value));
}

const isoByCountry = new Map();
for (const form of isoForms) {
  const list = isoByCountry.get(form.country_code) || [];
  list.push(form);
  isoByCountry.set(form.country_code, list);
}

const ohadaForms = [];
for (const country_code of OHADA_MEMBERS) {
  const existing = isoByCountry.get(country_code) || [];
  for (const template of OHADA_FORMS) {
    // Keep the ISO code when GLEIF has one for this jurisdiction. Enrich its
    // aliases with OHADA terminology (e.g. GLEIF's SUARL ↔ OHADA's SARLU)
    // instead of creating two choices for the same legal form.
    const matched = existing.find((form) => sameForm(form, template));
    if (matched) {
      matched.aliases = Array.from(
        new Set([
          ...matched.aliases,
          template.name,
          template.abbreviation,
          ...(template.aliases || []),
        ]),
      );
      continue;
    }
    ohadaForms.push({
      key: `${SOURCE_OHADA}:${country_code}:${template.code}`,
      code: template.code,
      source: SOURCE_OHADA,
      source_version: OHADA_VERSION,
      source_url: template.cooperative
        ? OHADA_COOPERATIVE_SOURCE_URL
        : OHADA_SOURCE_URL,
      country_code,
      country_name: countryName(country_code),
      jurisdiction_code: country_code,
      jurisdiction_name: countryName(country_code),
      name: template.name,
      abbreviation: template.abbreviation,
      aliases: Array.from(
        new Set([
          template.name,
          template.abbreviation,
          ...(template.aliases || []),
        ]),
      ),
      kind: template.kind || "LEGAL_ENTITY",
    });
  }
}

const CATALOGUE = [...isoForms, ...ohadaForms].sort(
  (a, b) =>
    a.country_code.localeCompare(b.country_code) ||
    // National forms first, then state/province jurisdictions alphabetically.
    Number(b.jurisdiction_code === b.country_code) -
      Number(a.jurisdiction_code === a.country_code) ||
    a.jurisdiction_name.localeCompare(b.jurisdiction_name) ||
    a.abbreviation.localeCompare(b.abbreviation) ||
    a.code.localeCompare(b.code),
);

const BY_COUNTRY = new Map();
const BY_KEY = new Map();
for (const form of CATALOGUE) {
  BY_KEY.set(form.key, form);
  const list = BY_COUNTRY.get(form.country_code) || [];
  list.push(form);
  BY_COUNTRY.set(form.country_code, list);
}

function forCountry(countryCode) {
  return BY_COUNTRY.get(String(countryCode || "").toUpperCase()) || [];
}

function byKey(key) {
  return BY_KEY.get(String(key || ""));
}

function byReference({ source, code, countryCode, jurisdictionCode } = {}) {
  const cc = String(countryCode || "").toUpperCase();
  const src = String(source || "");
  const elf = String(code || "");
  const jurisdiction = String(jurisdictionCode || "");
  return forCountry(cc).find(
    (form) =>
      form.source === src &&
      form.code === elf &&
      (!jurisdiction || form.jurisdiction_code === jurisdiction),
  );
}

/** Resolve a legacy printable value such as SARL or GmbH within its country. */
function matchStored(countryCode, value) {
  const needle = normalize(value);
  if (!needle) return undefined;
  const matches = forCountry(countryCode).filter((form) =>
    [form.abbreviation, form.name, ...(form.aliases || [])]
      .map(normalize)
      .includes(needle),
  );
  // Prefer a country-level form over a state/province form when old data did not
  // carry a subdivision. If still ambiguous, leave it unresolved: silently
  // assigning Alabama's LLC code to a Delaware company is worse than asking.
  const national = matches.filter(
    (form) => form.jurisdiction_code === form.country_code,
  );
  if (national.length === 1) return national[0];
  if (matches.length === 1) return matches[0];
  return undefined;
}

function isValidReference(reference) {
  return Boolean(byReference(reference));
}

exports.SOURCE_ISO = SOURCE_ISO;
exports.SOURCE_OHADA = SOURCE_OHADA;
exports.GLEIF_VERSION = generated.GLEIF_VERSION;
exports.GLEIF_RELEASED_ON = generated.GLEIF_RELEASED_ON;
exports.GLEIF_SOURCE_URL = generated.GLEIF_SOURCE_URL;
exports.GLEIF_SOURCE_SHA256 = generated.GLEIF_SOURCE_SHA256;
exports.OHADA_VERSION = OHADA_VERSION;
exports.OHADA_MEMBERS = OHADA_MEMBERS;
exports.CATALOGUE = CATALOGUE;
exports.forCountry = forCountry;
exports.byKey = byKey;
exports.byReference = byReference;
exports.matchStored = matchStored;
exports.isValidReference = isValidReference;
