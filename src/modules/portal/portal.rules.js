/** Portals — pure rules. A portal_access grant is usable only while active and
 *  before its expiry (auditor grants are time-boxed). */
"use strict";
function isGrantUsable(grant, now = Date.now()) {
  if (!grant || grant.is_active !== true) return false;
  if (grant.expires_at && Date.parse(grant.expires_at) < now) return false;
  return true;
}

/** The `setting` key (section 'portal') holding the client-invite defaults. */
const INVITE_DEFAULTS_KEY = "client_invite_defaults";

/** What a person at a client may see in the client portal (14150). */
const SCOPES = ["ALL", "OPERATIONS", "BILLING"];

/**
 * The tenant's defaults for a new client-portal invite, from the `setting` row
 * (section 'portal', key 'client_invite_defaults'), with anything missing or
 * malformed read as the behaviour the portal had before the setting existed:
 * everything visible, and the client's first portal user becomes its admin.
 */
function normalizeInviteDefaults(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    access_scope: SCOPES.includes(v.access_scope) ? v.access_scope : "ALL",
    first_is_admin: v.first_is_admin !== false,
  };
}

/**
 * Whether a new CLIENT grant makes its holder the client's portal admin. An
 * explicit choice wins; otherwise the first person a client is given access
 * through becomes its admin — unless the tenant switched that off.
 */
function resolveClientAdmin({ explicit, existingGrants, defaults }) {
  if (explicit === true || explicit === false) return explicit;
  return existingGrants === 0 && normalizeInviteDefaults(defaults).first_is_admin;
}

module.exports = { isGrantUsable, SCOPES, INVITE_DEFAULTS_KEY, normalizeInviteDefaults, resolveClientAdmin };
