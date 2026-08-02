/**
 * capability (RBAC-affecting). Wraps generic CRUD so every write invalidates the
 * identity/grant cache — a role/scope/visibility/capability change must be
 * reflected by requirePermission on the NEXT request, not after the 30s TTL
 * (stale RBAC is a security bug). Mirrors permission.service.js.
 *
 * Beyond the catalogue CRUD, this owns USER↔capability assignment — the authority
 * overlay requireCapability() reads. That path had no writer, so the SoD gate
 * could never be satisfied for a non-CEO user; without it, mounting
 * requireCapability('APPROVER') on a route would 403 every approver but the CEO.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const identityCache = require("../../../shared/cache/identity-cache");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./capability.repo");
const events = require("./capability.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "capability", events });

// The authority overlay a user may not grant to themselves (maker-checker).
// LINE_MANAGER is deliberately excluded — the documented rule (DB_ARCHITECTURE
// §108) names only these three.
const SELF_GRANT_BLOCKED = ["ISSUER", "VALIDATOR", "APPROVER"];

/**
 * Maker-checker: a user may not grant THEMSELVES ISSUER/VALIDATOR/APPROVER —
 * another administrator must (DB_ARCHITECTURE §108). Only a NEWLY added restricted
 * code is blocked, so an admin can still remove or keep an authority a *different*
 * admin already granted them; clearing the set is always allowed. Runs on the same
 * (live, identity-pinned) client as the write, so "in Live" is automatic — there is
 * no separate sandbox authority set to exempt, which is what the old
 * permission.service `req.env` TODO predated.
 */
async function assertNoSelfAuthorityGrant(client, userId, capabilityIds) {
  const ids = capabilityIds || [];
  if (!ids.length) return;
  const { rows } = await client.query(
    "SELECT capability_id, code FROM capability WHERE capability_id = ANY($1::uuid[])",
    [ids],
  );
  const requestedRestricted = rows.filter((r) => SELF_GRANT_BLOCKED.includes(String(r.code).toUpperCase()));
  if (!requestedRestricted.length) return;
  const current = await repo.userCapabilities(client, userId);
  const held = new Set(current.map((c) => String(c.capability_id)));
  const adding = requestedRestricted.filter((r) => !held.has(String(r.capability_id)));
  if (adding.length) {
    const codes = adding.map((r) => r.code).join(", ");
    throw new AppError(
      "SELF_GRANT_FORBIDDEN",
      `You cannot grant yourself the ${codes} authority — another administrator must (maker-checker).`,
      403,
    );
  }
}

module.exports = {
  ...base,
  async create(client, args) { const r = await base.create(client, args); await identityCache.invalidateGrants(); return r; },
  async update(client, args) { const r = await base.update(client, args); await identityCache.invalidateGrants(); return r; },
  async archive(client, args) { const r = await base.archive(client, args); await identityCache.invalidateGrants(); return r; },

  /** The blanket capabilities a user holds (for the assignment UI). */
  async listForUser(client, userId) {
    return repo.userCapabilities(client, userId);
  },

  /**
   * Set a user's blanket capabilities (replace-all). Security-critical: emits
   * capability.updated (→ Watch-the-Watcher) and invalidates that user's identity
   * cache (caps live under the identity:caps namespace, which invalidateGrants
   * does NOT touch — invalidateUser does). Runs in the caller's transaction.
   *
   * Maker-checker: a user cannot grant THEMSELVES Issuer/Validator/Approver — see
   * assertNoSelfAuthorityGrant above (DB_ARCHITECTURE §108).
   */
  async setForUser(client, { userId, capabilityIds, actor }) {
    if (actor && actor.user_id && String(actor.user_id) === String(userId)) {
      await assertNoSelfAuthorityGrant(client, userId, capabilityIds);
    }
    await repo.setUserCapabilities(client, userId, capabilityIds);
    await identityCache.invalidateUser(userId);
    // Emit "role.changed" (seeded is_security_critical in 9020) rather than
    // "capability.updated" (which is not), so this authority change triggers the
    // Watch-the-Watcher HIGH notification to CEO/MANAGEMENT like every other
    // permission edit. event_log.event_type_key has no FK, so the key is free.
    await emitEvent(client, {
      eventTypeKey: "role.changed",
      moduleKey: events.MODULE,
      entityRef: `user_capability:${userId}`,
      actorUserId: actor && actor.user_id,
    });
    await audit(client, {
      actorUserId: actor && actor.user_id,
      action: "user.capability.changed",
      moduleKey: events.MODULE,
      entityRef: `user_capability:${userId}`,
      after: { user_id: userId, capability_ids: capabilityIds || [] },
    });
    return repo.userCapabilities(client, userId);
  },
};
