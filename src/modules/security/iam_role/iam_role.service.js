/**
 * IAM roles (MOD-67). Generic CRUD + (a) grant-cache invalidation on every write
 * (roles drive what grants resolve to) and (b) a guard: seeded system roles and
 * the CEO role cannot be archived/deleted (they're structural).
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const identityCache = require("../../../shared/cache/identity-cache");
const { AppError } = require("../../../utils/errors");
const repo = require("./iam_role.repo");
const events = require("./iam_role.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "iam_role", events });

module.exports = {
  ...base,
  async create(client, args) { const r = await base.create(client, args); await identityCache.invalidateGrants(); return r; },
  async update(client, args) { const r = await base.update(client, args); await identityCache.invalidateGrants(); return r; },
  async archive(client, args) {
    const before = await repo.findById(client, args.id);
    if (before && (before.is_system === true || String(before.code).toUpperCase() === "CEO")) {
      throw new AppError("PROTECTED_ROLE", "System/CEO roles cannot be deleted", 409);
    }
    const r = await base.archive(client, args);
    await identityCache.invalidateGrants();
    return r;
  },
};
