/**
 * The grant matrix editor: role x module_key -> can_create/read/update/
 * delete/approve. Every write here changes what `requirePermission()`
 * allows, so it must invalidate the identity cache immediately (grants are
 * cached for 30s in identity-cache.js — see rbac.js), and per WORK_TO_BE_DONE.md
 * Phase 0 this is a Watch-the-Watcher trigger point (high-priority event +
 * CEO/Management notify) and, in Live, must block a Super Admin
 * self-granting Issuer/Validator/Approver (maker-checker).
 *
 * TODO (not implemented here — flagging, not silently skipping):
 *   - Self-grant block in Live: needs req.env / req.user available at the
 *     service layer (currently only client/actor are threaded through
 *     makeService) — wire once the Live/Sandbox toggle is exposed here.
 *   - CEO/Management notification consumer for the high-priority event —
 *     belongs to the notifications module, not this one.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
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
};
