/**
 * capability (RBAC-affecting). Wraps generic CRUD so every write invalidates the
 * identity/grant cache — a role/scope/visibility/capability change must be
 * reflected by requirePermission on the NEXT request, not after the 30s TTL
 * (stale RBAC is a security bug). Mirrors permission.service.js.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const identityCache = require("../../../shared/cache/identity-cache");
const repo = require("./capability.repo");
const events = require("./capability.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "capability", events });

module.exports = {
  ...base,
  async create(client, args) { const r = await base.create(client, args); await identityCache.invalidateGrants(); return r; },
  async update(client, args) { const r = await base.update(client, args); await identityCache.invalidateGrants(); return r; },
  async archive(client, args) { const r = await base.archive(client, args); await identityCache.invalidateGrants(); return r; },
};
