/**
 * The Shared Shipment/Service Detail Component — pure projection rules.
 *
 * WHAT THIS FILE IS FOR. Every consumer of an operations file — costing,
 * quotation, proforma, final invoice, transit order, delivery note, the client
 * portal, and whatever is built next year — needs to print the same header
 * block: what is moving, under which reference, on what, from where to where,
 * arriving when. The fields that answer those questions are DIFFERENT on every
 * service type (a Bill of Lading on sea, a MAWB on air, a warehouse and a
 * bonded status on storage), and in the legacy system every consumer solved
 * that for itself. There were three copies of this logic — `smartTransportRef`
 * / `smartConveyance` / `smartRoute` in browser JavaScript, and two more in PHP
 * — and they had already drifted apart.
 *
 * So it is written ONCE, here, as pure functions over a dossier row and its
 * field definitions. No SQL, no HTTP, no formatting decisions that belong to a
 * template. The repo fetches, the service composes, this decides MEANING.
 *
 * HOW IT KNOWS WHAT A FIELD MEANS. Not by key — keys are per service type and a
 * tenant invents their own. By `facet_role`, the tag the service-type owner puts
 * on a field when they define it (0660). "Bill of Lading" on Sea and "MAWB" on
 * Air are both TRANSPORT_REF; the panel asks for TRANSPORT_REF and gets the
 * right one without knowing either service type exists.
 *
 * A FACET WITH NO FIELDS IS ABSENT, NOT EMPTY. A warehousing file has no
 * conveyance and no route, and the panel must not render "Vessel: —" on it.
 * `facets` only contains what the service type actually defines, which is what
 * lets one component serve twelve service types without a single conditional.
 */
"use strict";

/**
 * How several fields carrying the SAME role combine into one displayed value.
 *
 *   JOIN  — genuinely multi-part. Vessel + voyage is "MSC ARUSHI / 128W"; MAWB +
 *           HAWB is one reference pair. Legacy joined these with "/" and it read
 *           well, so it is kept.
 *   FIRST — single-valued; extra fields with the role are a definition mistake,
 *           and taking the first (by seq) is the predictable answer.
 *   LAST  — the later value SUPERSEDES the earlier. This is how ETA and ATA
 *           relate: both are tagged ARRIVAL_DATE, ATA sits after ETA in the
 *           form, and once an actual arrival is recorded every document should
 *           print it instead of the estimate. Legacy expressed the same rule as
 *           `d.ata || d.eta`; ordering by seq generalises it to any service type
 *           without naming those two fields anywhere.
 */
const COMBINE = {
  TRANSPORT_REF: { how: "JOIN", sep: " / " },
  CONVEYANCE: { how: "JOIN", sep: " / " },
  ROUTE_VIA: { how: "JOIN", sep: " · " },
  DEPARTURE_DATE: { how: "LAST" },
  ARRIVAL_DATE: { how: "LAST" },
};
const DEFAULT_COMBINE = { how: "FIRST" };

/**
 * The order facets are presented in. A consumer that just wants "the header
 * block" iterates this and gets a sensible reading order for ANY service type;
 * one that wants a specific fact looks it up by role.
 *
 * Movement first, then what is moving, then custody, then the paperwork, then
 * the non-movement services' own vocabulary. Roles a service type does not use
 * simply never appear.
 */
const FACET_ORDER = [
  "TRANSPORT_REF", "CARRIER", "CONVEYANCE",
  "ORIGIN", "ROUTE_VIA", "DESTINATION",
  "DEPARTURE_DATE", "ARRIVAL_DATE",
  "CARGO_DESC", "CARGO_WEIGHT", "CARGO_VOLUME", "CARGO_PACKAGES", "CARGO_MARKS",
  "CUSTODY_LOCATION", "CUSTODY_STATUS", "CUSTODY_IN", "CUSTODY_OUT",
  "INCOTERM", "CUSTOMS_REGIME", "CUSTOMS_REF",
  "SCOPE_SUMMARY", "COUNTERPARTY", "PERIOD_START", "PERIOD_END",
];

/** English/French display names for a facet, used when a consumer renders the
 *  canonical strip rather than the service type's own field labels. */
const FACET_LABEL = {
  TRANSPORT_REF: { en: "Transport reference", fr: "Référence de transport" },
  CARRIER: { en: "Carrier", fr: "Transporteur" },
  CONVEYANCE: { en: "Conveyance", fr: "Moyen de transport" },
  ORIGIN: { en: "Origin", fr: "Origine" },
  ROUTE_VIA: { en: "Via", fr: "Via" },
  DESTINATION: { en: "Destination", fr: "Destination" },
  DEPARTURE_DATE: { en: "Departure", fr: "Départ" },
  ARRIVAL_DATE: { en: "Arrival", fr: "Arrivée" },
  CARGO_DESC: { en: "Commodity", fr: "Marchandise" },
  CARGO_WEIGHT: { en: "Weight", fr: "Poids" },
  CARGO_VOLUME: { en: "Volume", fr: "Volume" },
  CARGO_PACKAGES: { en: "Packages", fr: "Colis" },
  CARGO_MARKS: { en: "Marks & numbers", fr: "Marques & numéros" },
  CUSTODY_LOCATION: { en: "Location", fr: "Emplacement" },
  CUSTODY_STATUS: { en: "Customs status", fr: "Statut douanier" },
  CUSTODY_IN: { en: "In", fr: "Entrée" },
  CUSTODY_OUT: { en: "Out", fr: "Sortie" },
  INCOTERM: { en: "Incoterm", fr: "Incoterm" },
  CUSTOMS_REGIME: { en: "Customs regime", fr: "Régime douanier" },
  CUSTOMS_REF: { en: "Declaration", fr: "Déclaration" },
  SCOPE_SUMMARY: { en: "Scope", fr: "Objet" },
  COUNTERPARTY: { en: "Contact", fr: "Interlocuteur" },
  PERIOD_START: { en: "From", fr: "Du" },
  PERIOD_END: { en: "To", fr: "Au" },
};

const isBlank = (v) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * A date column comes back from pg as a Date; a date inside details_json comes
 * back as the string it was written as. Both must print identically, and
 * neither should acquire a timezone on the way — a `date` has no time of day,
 * and rendering one in the reader's zone is how an ETA moves a day backwards.
 */
function asDateString(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return String(v);
}

/**
 * The stored value of one field, wherever it lives.
 *
 * `column_name` set → the field IS that dossier column (the hybrid: pol, pod,
 * bl_mawb… keep their columns and their foreign keys). Otherwise the value is a
 * property of `details_json` under the field's key.
 */
function rawValue(field, dossier, details) {
  if (field.column_name) return dossier ? dossier[field.column_name] : null;
  return details ? details[field.key] : null;
}

/**
 * Turn a stored value into something printable, using the field's own
 * definition — a SELECT shows its label, not its code; a boolean shows Yes/No;
 * a reference shows the name the caller resolved for it.
 *
 * `resolved` carries lookups the repo did (currently rate_provider names): a
 * pure function cannot query, and a projection that printed a raw uuid for the
 * carrier would be worse than useless on an invoice.
 */
function displayValue(field, value, { lang = "en", resolved = {} } = {}) {
  if (isBlank(value)) return null;
  const pick = (fr, en) => (lang === "fr" ? fr || en : en || fr);

  switch (field.data_type) {
    case "BOOLEAN":
      return value === true || value === "true"
        ? pick("Oui", "Yes")
        : pick("Non", "No");
    case "DATE":
    case "DATETIME":
      return asDateString(value);
    case "SELECT":
    case "MULTISELECT": {
      const opts = Array.isArray(field.options_json) ? field.options_json : [];
      const one = (v) => {
        const o = opts.find((x) => String(x.value) === String(v));
        return o ? pick(o.label_fr, o.label_en) : String(v);
      };
      return Array.isArray(value) ? value.map(one).join(", ") : one(value);
    }
    case "RATE_PROVIDER":
      // The uuid is the truth; the name is what a human reads. Falling back to
      // the id rather than to null keeps a mis-seeded reference visible instead
      // of making the carrier silently vanish from every document.
      return resolved.rate_provider_name || String(value);
    case "NUMBER":
    case "INTEGER": {
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : String(value);
    }
    default:
      return String(value);
  }
}

/**
 * Group the active fields of a set into the sections the form renders, in
 * order. Used by the dossier form AND by the detail panel's "everything else"
 * section, so the two can never disagree about what belongs where.
 */
function toGroups(fields, { lang = "en" } = {}) {
  const out = [];
  const byCode = new Map();
  for (const f of fields) {
    if (f.is_active === false) continue;
    let g = byCode.get(f.group_code);
    if (!g) {
      g = {
        code: f.group_code,
        label: lang === "fr"
          ? f.group_label_fr || f.group_label_en || f.group_code
          : f.group_label_en || f.group_label_fr || f.group_code,
        seq: f.group_seq,
        fields: [],
      };
      byCode.set(f.group_code, g);
      out.push(g);
    }
    g.fields.push(f);
  }
  out.sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code));
  for (const g of out) g.fields.sort((a, b) => Number(a.seq) - Number(b.seq));
  return out;
}

/**
 * Build the canonical facet map for one dossier.
 *
 * Returns `{ ROLE: { role, label, value, parts:[…] } }` containing ONLY the
 * roles this service type actually defines AND has a value for. `parts` keeps
 * the contributing fields so a consumer can show provenance ("Vessel" and
 * "Voyage No" behind one Conveyance line) without re-deriving anything.
 */
function toFacets(fields, dossier, details, opts = {}) {
  const { lang = "en", resolved = {} } = opts;
  const byRole = new Map();

  for (const f of fields) {
    if (f.is_active === false || !f.facet_role) continue;
    const shown = displayValue(f, rawValue(f, dossier, details), { lang, resolved });
    if (shown === null) continue;
    if (!byRole.has(f.facet_role)) byRole.set(f.facet_role, []);
    byRole.get(f.facet_role).push({
      key: f.key,
      label: lang === "fr" ? f.label_fr : f.label_en || f.label_fr,
      value: shown,
      seq: Number(f.seq),
    });
  }

  const facets = {};
  for (const [role, parts] of byRole) {
    parts.sort((a, b) => a.seq - b.seq);
    const rule = COMBINE[role] || DEFAULT_COMBINE;
    let value;
    if (rule.how === "JOIN") value = parts.map((p) => p.value).join(rule.sep);
    else if (rule.how === "LAST") value = parts[parts.length - 1].value;
    else value = parts[0].value;

    // The weight facet is the one place a second field is a MODIFIER rather
    // than a part: "12500" and "KG" are one fact. The unit is deliberately not
    // given a facet role of its own (it would render as a meaningless row), so
    // it is appended here from the dossier column the seed binds it to.
    if (role === "CARGO_WEIGHT" && dossier && dossier.weight_unit) {
      value = `${value} ${dossier.weight_unit}`;
    }
    if (role === "CARGO_VOLUME") value = `${value} m³`;

    const lbl = FACET_LABEL[role] || { en: role, fr: role };
    facets[role] = {
      role,
      label: lang === "fr" ? lbl.fr : lbl.en,
      value,
      parts: parts.map(({ key, label, value: v }) => ({ key, label, value: v })),
    };
  }
  return facets;
}

/**
 * "SHANGHAI → DOUALA", or with waypoints "SHANGHAI → DOUALA → N'DJAMENA".
 *
 * Returns null rather than a placeholder when the service type has no route at
 * all: a warehousing or representation file has no origin and no destination,
 * and printing an arrow between two blanks is exactly the noise the legacy
 * panel produced.
 */
function routeLabel(facets) {
  const parts = ["ORIGIN", "ROUTE_VIA", "DESTINATION"]
    .map((r) => facets[r] && facets[r].value)
    .filter(Boolean);
  return parts.length >= 2 ? parts.join(" → ") : null;
}

/**
 * How much of the form is filled in — the honest alternative to blocking a file
 * at creation over an ETA nobody can know yet.
 *
 * `required` counts only the fields the service-type owner marked required (and
 * which are therefore enforced on write); `overall` counts every active field,
 * which is what the "78% complete" badge on the file reads from. Fields that
 * are required are reported separately when missing so the UI can name them.
 */
function completeness(fields, dossier, details) {
  const active = fields.filter((f) => f.is_active !== false);
  const filled = (f) => !isBlank(rawValue(f, dossier, details));
  const required = active.filter((f) => f.is_required);
  const missingRequired = required.filter((f) => !filled(f)).map((f) => f.key);
  const filledCount = active.filter(filled).length;
  return {
    total: active.length,
    filled: filledCount,
    percent: active.length ? Math.round((filledCount / active.length) * 100) : 100,
    required_total: required.length,
    required_filled: required.length - missingRequired.length,
    missing_required: missingRequired,
    is_complete: active.length > 0 && filledCount === active.length,
  };
}

module.exports = {
  COMBINE,
  FACET_ORDER,
  FACET_LABEL,
  rawValue,
  displayValue,
  toGroups,
  toFacets,
  routeLabel,
  completeness,
  isBlank,
  asDateString,
};
