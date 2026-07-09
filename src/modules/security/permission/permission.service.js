/**
 * The grant matrix editor: role x module_key -> can_create/read/update/
 * delete/approve. Every write here changes what `requirePermission()` allows,
 * so it must invalidate the identity cache immediately (grants are cached for
 * 30s in identity-cache.js — see rbac.js). It's also a Watch-the-Watcher trigger
 * point: writes emit `permission.changed` (seeded security-critical), which
 * shared/events/emit.js fans out as a HIGH notification to CEO/Management.
 *
 * TODO (not implemented here — flagging, not silently skipping):
 *   - Self-grant block in Live: needs req.env / req.user available at the
 *     service layer (currently only client/actor are threaded through
 *     makeService) — wire once the Live/Sandbox toggle is exposed here.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const identityCache = require("../../../shared/cache/identity-cache");
const repo = require("./permission.repo");
const events = require("./permission.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "permission", events });

module.exports = {
  ...base,
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
