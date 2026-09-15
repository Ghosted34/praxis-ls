/**
 * Tile eligibility — two reads, no opinions.
 *
 * A tile is eligible when the SUBJECT (one user, or one role being edited)
 * can READ the module the tile aggregates, AND no field-visibility row masks
 * the tile's sensitive field. Both answers come from rows `0110_rbac.sql`
 * made canonical; this file adds a join, not a policy.
 *
 * WHY THE ROLE EDITOR SHARES THIS FUNCTION. When an admin configures
 * Operations' band, "eligible" must mean the SAME thing it will mean for every
 * member at read time — otherwise the picker offers a tile the server then
 * hides from everyone holding the role, which is the "settings page that lies"
 * bug in editor form. One function, two subjects.
 *
 * CEO. `rbac.js` bypasses every grant check for the seeded CEO role, so
 * eligibility must too — or the CEO's picker offers less than the CEO can
 * read, and the band's rule ("the picker shows exactly what can render")
 * breaks on the one account that evaluates it most. Field visibility still
 * applies: the CEO bypass is about GRANTS; the salary mask is a row an admin
 * can also set for the CEO, and honoring it is honoring that admin.
 */
"use strict";

const { CATALOG } = require("./index");

/** The distinct module keys and field keys the catalog references. One query's
 *  worth of parameters, computed once at load — 31 tiles, a handful of reads. */
const MODULES = [...new Set(CATALOG.map((e) => e.module))];
const FIELD_KEYS = [...new Set(CATALOG.map((e) => e.sensitive_field).filter(Boolean))];

/**
 * Readable module keys for a set of role ids.
 * `roleIds: []` reads as a subject with no grants, not a wildcard.
 */
async function readableModules(client, roleIds) {
  if (!client || !Array.isArray(roleIds)) return new Set();
  if (!roleIds.length || !MODULES.length) return new Set();
  const { rows } = await client.query(
    "SELECT DISTINCT module_key FROM permission WHERE role_id = ANY($1::uuid[]) AND can_read = true AND module_key = ANY($2::text[])",
    [roleIds, MODULES],
  );
  return new Set(rows.map((r) => String(r.module_key).toUpperCase()));
}

/**
 * Field keys MASKED from the subject. Absence of a row is visibility (the
 * seeded convention); any masked|hidden row for any of the subject's roles
 * masks — the most restrictive role wins, because a grant given by role A
 * must not launder a confidentiality rule set for role B.
 */
async function maskedFields(client, roleIds) {
  if (!client || !Array.isArray(roleIds) || !roleIds.length || !FIELD_KEYS.length) {
    return new Set();
  }
  const { rows } = await client.query(
    "SELECT DISTINCT field_key FROM field_visibility WHERE role_id = ANY($1::uuid[]) AND field_key = ANY($2::text[]) AND visibility <> 'visible'",
    [roleIds, FIELD_KEYS],
  );
  return new Set(rows.map((r) => String(r.field_key)));
}

/**
 * The live catalog ids this subject may see, given its grants and masks.
 * Availability (does the relation exist in this schema) is deliberately NOT
 * applied here — that is a per-request business-schema fact (§
 * index.availableRelations), and a role being edited has no "current schema":
 * the role config stores scope over ELIGIBLE ids; the band intersects with
 * availability at read time and shrinks, per the guide's §6.2.
 */
function eligibleIds(readable, masked, { isCeo = false } = {}) {
  return CATALOG.filter((e) => e.status === "live")
    .filter((e) => isCeo || readable.has(String(e.module).toUpperCase()))
    .filter((e) => !(e.sensitive_field && masked.has(e.sensitive_field)))
    .map((e) => e.id);
}

/** Everything the endpoints answer with, in one call. */
async function resolveEligibility(client, { roleIds, isCeo = false }) {
  const [readable, masked] = await Promise.all([
    readableModules(client, roleIds),
    maskedFields(client, roleIds),
  ]);
  return {
    readable,
    masked,
    liveIds: eligibleIds(readable, masked, { isCeo }),
  };
}

module.exports = {
  MODULES,
  FIELD_KEYS,
  readableModules,
  maskedFields,
  eligibleIds,
  resolveEligibility,
};
