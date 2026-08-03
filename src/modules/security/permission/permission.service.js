/**
 * The grant matrix editor: role x module_key -> can_create/read/update/
 * delete/approve. Every write here changes what `requirePermission()` allows,
 * so it must invalidate the identity cache immediately (grants are cached for
 * 30s in identity-cache.js — see rbac.js). It's also a Watch-the-Watcher trigger
 * point: writes emit `permission.changed` (seeded security-critical), which
 * shared/events/emit.js fans out as a HIGH notification to CEO/Management.
 *
 * Self-grant maker-checker (DB_ARCHITECTURE §108 — "a Super Admin cannot
 * self-grant Issuer/Validator/Approver") is enforced where authority is actually
 * assignable: capability.service.setForUser blocks a user adding a restricted
 * capability to themselves. It lives there, not here, because the documented rule
 * is about the ISSUER/VALIDATOR/APPROVER authority overlay, not this role×module
 * grant matrix. The identity tables are pinned to the live schema, so the block is
 * unconditional — that pinning is what the old "needs req.env" note predated.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const identityCache = require("../../../shared/cache/identity-cache");
const repo = require("./permission.repo");
const events = require("./permission.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "permission", events, deleteMode: "hard"});

module.exports = {
  ...base,
  // Unpaginated read for the matrix editor — see permission.repo.listAll for
  // why the paginated list() is unsafe there.
  listAll: (client) => repo.listAll(client),
  async create(client, args) {
    const row = await base.create(client, args);
    await identityCache.invalidateGrants();
    return row;
  },
  async update(client, args) {
    const row = await base.update(client, args);
    await identityCache.invalidateGrants();
    return row;
  },
  async archive(client, args) {
    const row = await base.archive(client, args);
    await identityCache.invalidateGrants();
    return row;
  },

  // Upsert by (role_id, module_key) — what the grant-matrix uses. Emits the
  // security-critical permission.changed event (→ Watch-the-Watcher) and
  // invalidates the grant cache, same as create/update above.
  async upsertGrant(client, { data, actor }) {
    const row = await repo.upsertGrant(client, data);
    await identityCache.invalidateGrants();
    await emitEvent(client, {
      eventTypeKey: events.UPDATED, // "permission.changed"
      moduleKey: events.MODULE,
      entityRef: `permission:${row.permission_id}`,
      actorUserId: actor.user_id,
    });
    await audit(client, {
      actorUserId: actor.user_id,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: `permission:${row.permission_id}`,
      after: row,
    });
    return row;
  },
};
