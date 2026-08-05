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

const repo = require("./permission.repo");
const crypto = require("crypto");
const catalogueRepo = require("../../catalogue/catalogue.repo");

/**
 * What the navigation shell may render for the CALLER.
 *
 * WHY THE SHELL NEEDS AN ENDPOINT AT ALL. Until now the client knew nothing
 * about permissions — `/auth/me` returns a name, a role label and two feature
 * flags — so every user saw every destination and found out what they could not
 * do by clicking it and getting a 403. A ribbon whose tabs differ per role
 * cannot be built on that.
 *
 * SHAPE. `{ modules, groups, byGroup, isCeo, version }`:
 *   modules  the MOD-xx keys this caller can read
 *   groups   the six workflow verbs those keys fall into, in catalogue order —
 *            resolved here rather than in the browser so the taxonomy has one
 *            definition (platform.module_catalogue.group_key) and the client
 *            has no second mapping to drift from it
 *   byGroup  the same partition, spelled out: verb → its visible module keys
 *   isCeo    the CEO bypass rbac.js already applies, surfaced so the shell
 *            agrees with the enforcement path instead of showing a CEO an empty
 *            ribbon
 *   version  a short digest of the resolved set
 *
 * WHY `byGroup` AND NOT JUST `groups`. `groups` says which tabs exist; it does
 * not say what belongs under one. The ribbon's second row has to place a
 * destination under a verb, and the only two ways to do that are to ship the
 * membership with the response or to write the taxonomy a second time in the
 * browser. The second is the thing this endpoint exists to prevent — a client
 * map would be a copy of `module_catalogue.group_key` that nothing keeps honest,
 * and it would go stale silently the first time a module is regrouped. So the
 * partition travels with the answer. The client still owns which ICON and which
 * ROUTE a key gets, because those are drawings and URLs, not taxonomy.
 *
 * WHAT `version` IS FOR. The client renders its LAST KNOWN ribbon immediately
 * from cache and revalidates in the background, so switching pages never
 * flashes an empty header. Comparing versions is how it learns the cache is
 * stale — and, because the digest covers the exact key set, a REVOCATION is
 * distinguishable from a GRANT by comparing the sets themselves. That
 * distinction is the point: losing access has to take effect at once, whereas
 * forcing a reload to tell someone they have gained a module would throw away
 * whatever they were typing to deliver news that cannot expose anything.
 */
async function navAccess(client, user) {
  const catalogue = await catalogueRepo.listModules();

  // The CEO bypass is not a shortcut here — rbac.js grants the CEO every module
  // regardless of the permission table, so resolving from grants alone would
  // hand a CEO with no explicit rows an empty ribbon over an app that lets them
  // do everything.
  const modules = user.is_ceo
    ? catalogue.map((m) => m.module_key)
    : await repo.visibleModuleKeys(client, user.role_ids || []);

  const visible = new Set(modules.map((k) => String(k).toUpperCase()));
  const groups = [];
  const byGroup = {};
  for (const m of catalogue) {
    if (!visible.has(String(m.module_key).toUpperCase())) continue;
    if (!byGroup[m.group_key]) {
      byGroup[m.group_key] = [];
      groups.push(m.group_key);
    }
    // Uppercased like `modules`, so the client can compare the two sets without
    // knowing that one came from a grant row and the other from the catalogue.
    byGroup[m.group_key].push(String(m.module_key).toUpperCase());
  }

  // Sorted before hashing: the digest must describe the SET, not the order the
  // database happened to return it in, or every request would look like a change.
  const version = crypto
    .createHash("sha1")
    .update([...visible].sort().join(","))
    .digest("hex")
    .slice(0, 12);

  return { modules: [...visible].sort(), groups, byGroup, isCeo: Boolean(user.is_ceo), version };
}

const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const identityCache = require("../../../shared/cache/identity-cache");
const events = require("./permission.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "permission", events, deleteMode: "hard"});

module.exports = {
  navAccess,
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
