/**
 * Country-first create/edit write helpers shared by both masters (PR3-B §2).
 *
 * The revamped create form is country-first: it sends a `registrations` array
 * (the dynamic tax/legal IDs the selected country requires), plus a
 * `primary_contact` and `primary_address` block. The master service pulls those
 * out of the flat payload and this helper writes them as their own rows inside
 * the SAME transaction as the master insert — so a client and its NIU, its
 * billing contact and its registered address either all land or none do.
 *
 * Registrations are the source of truth (`party_registration`); for OHADA/CM the
 * NIU and RCCM are ALSO mirrored onto the master's legacy `niu`/`rccm` columns,
 * because every invoice, statement and report still reads those.
 *
 * The expected-registration set (which regex validates which ID) comes from the
 * shared `expectedRegistrations` helper — the ONE definition the create form
 * renders from too, so the two cannot disagree. Imported by subpath because the
 * helper is a ready module in packages/shared not (yet) on the shared index.
 */
"use strict";
const { insertOne } = require("../../../shared/db/query-helpers");
const { AppError } = require("../../../utils/errors");
const { expectedRegistrations } = require("@praxis/shared/data/registrations");

// The nested-resource write allow-lists (kept identical to _shared/nested.js so
// the transactional create path and the REST path write the same columns).
const CONTACT_COLS = ["name", "title", "email", "phone", "role_tags", "is_primary", "language", "timezone", "portal_access", "is_active"];
const ADDRESS_COLS = ["line1", "line2", "city", "region", "postal_code", "country_code", "type", "is_primary", "is_active"];
const REG_COLS = ["country_code", "kind", "number", "issuing_authority", "issued_on", "expires_on"];

/** Lower-case, trim, collapse internal whitespace — matches the 0513 backfill so
 *  the write path and the migration agree on the dedup key. */
function normalizeName(data = {}) {
  const src = data.legal_name || data.name || "";
  const norm = String(src).toLowerCase().replace(/\s+/g, " ").trim();
  return norm || null;
}

/** The NIU/RCCM values to mirror onto the master from a registrations array. */
function niuRccmMirror(registrations = []) {
  const out = {};
  for (const r of registrations || []) {
    const kind = String(r.kind || "").toUpperCase();
    if (kind === "NIU" && r.number) out.niu = r.number;
    if (kind === "RCCM" && r.number) out.rccm = r.number;
  }
  return out;
}

/**
 * Validate the FORMAT of each supplied registration against the country/
 * category expected set (the backend half of the "one definition of valid").
 * Deliberately does NOT reject a MISSING required ID — an incomplete draft is an
 * onboarding gap the compliance engine reports, not a hard create failure
 * (Hard Rule 9 / the ONBOARDING model). Throws 422 on a badly-formatted value.
 */
function validateRegistrations({ registrations, country, kind, category }) {
  if (!Array.isArray(registrations) || registrations.length === 0) return;
  const expected = expectedRegistrations({ country, kind, category });
  const byKind = new Map(expected.map((e) => [e.kind.toUpperCase(), e]));
  const errors = {};
  for (const r of registrations) {
    const number = r && r.number ? String(r.number).trim() : "";
    if (!number) continue;
    const spec = byKind.get(String(r.kind || "").toUpperCase());
    if (spec && spec.regex) {
      let re;
      try { re = new RegExp(spec.regex); } catch { re = null; }
      if (re && !re.test(number)) errors[`registrations.${r.kind}`] = [`Invalid ${r.kind} format`];
    }
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION_ERROR", "Invalid registration format", 422, errors);
}

/**
 * Write the country-first child rows for a freshly-created (or edited) party,
 * inside the caller's open transaction. Reuses the vetted nested allow-lists so
 * the columns cannot drift from the REST path.
 */
async function writeChildren(client, { kind, partyId, registrations, primary_contact, primary_address }) {
  const parentCol = `${kind}_id`;
  for (const r of registrations || []) {
    if (!r || (!r.number && !r.kind)) continue;
    await insertOne(client, "party_registration", { ...r, [parentCol]: partyId }, "*", [...REG_COLS, parentCol]);
  }
  if (primary_contact && primary_contact.name) {
    await insertOne(client, `${kind}_contact`, { ...primary_contact, is_primary: true, [parentCol]: partyId }, "*", [...CONTACT_COLS, parentCol]);
  }
  if (primary_address) {
    const hasAny = ["line1", "city", "region", "postal_code", "country_code"].some((k) => primary_address[k]);
    if (hasAny) {
      await insertOne(
        client, `${kind}_address`,
        { ...primary_address, is_primary: true, type: primary_address.type || "REGISTERED", [parentCol]: partyId },
        "*", [...ADDRESS_COLS, parentCol],
      );
    }
  }
}

module.exports = { normalizeName, niuRccmMirror, validateRegistrations, writeChildren, CONTACT_COLS, ADDRESS_COLS, REG_COLS };
