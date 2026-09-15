/**
 * role_kpi — what a role's members see in the Control Tower band, and what
 * they may choose. Three arrays, one rule: THE CONFIG CAN ONLY EVER SPEAK OF
 * WHAT THE ROLE CAN READ.
 *
 * WHY ELIGIBILITY IS VALIDATED HERE AND ALSO APPLIED AT READ TIME. The
 * permission matrix and this config can change in either order: an admin
 * narrows a role's grants, and the band must not keep showing what the
 * revocation killed (read-time filter, `kpi_catalog/resolve.js`); an admin
 * writes a config naming a module the role cannot read, and the write fails
 * with the grant it would need (this file). Validation on write makes the
 * matrix→config ordering explicit — first what a role may read, then what it
 * must look at — which is the sequence a tenant admin actually learns the
 * feature in, and the reason the KPI step sits AFTER the permission matrix
 * in the roles screen.
 *
 * WHY A REVOCATION PRUNES (rather than leaves a hidden entry to "come back"):
 * `permission.changed` is a security event; the config row is a display
 * preference. Leaving revoked modules living in the role's scope means
 * re-granting the module silently resurrects a band its owner deleted months
 * ago. The prune makes re-grant mean "default, then configured", and the
 * audit trail carries both rows.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { audit } = require("../../../shared/events/emit");
const catalog = require("../../dashboard/kpi_catalog");
const eligibility = require("../../dashboard/kpi_catalog/eligibility");
const { MAX_BAND_TILES } = require("../../dashboard/kpi_catalog/shared");
const repo = require("./role_kpi.repo");

const { BY_ID, LIVE_IDS } = catalog;

/** The ids the role can read right now (grants + masks), for write validation. */
async function eligibleForRole(client, roleId, roleCode) {
  const readable = await eligibility.readableModules(client, [roleId]);
  const masked = await eligibility.maskedFields(client, [roleId]);
  const isCeo = String(roleCode || "").toUpperCase() === "CEO";
  return { isCeo, live: new Set(eligibility.eligibleIds(readable, masked, { isCeo })) };
}

function assertIds(field, ids) {
  for (const id of ids) {
    if (!BY_ID.has(id)) {
      throw new AppError(
        "UNKNOWN_KPI_ID",
        `${field} names "${id}", which is not a KPI in the catalog.`,
        422,
      );
    }
  }
}

/**
 * Validate + write the config. `config === null` clears the row (back to the
 * system default for this role's members).
 */
async function put(client, { roleId, config, actor }) {
  const { rows: roleRows } = await client.query(
    "SELECT role_id, code FROM role WHERE role_id = $1",
    [roleId],
  );
  if (!roleRows[0]) throw new AppError("ROLE_NOT_FOUND", "Role not found", 404);

  const before = await repo.get(client, roleId);
  if (config === null || config === undefined) {
    if (before) {
      await repo.clear(client, roleId);
      await auditRoleChange(client, { actor, roleId, before, after: null });
    }
    return null;
  }

  const scopeIds = Array.isArray(config.scopeIds) ? [...new Set(config.scopeIds)] : null;
  const defaultIds = Array.isArray(config.defaultIds) ? config.defaultIds : [];
  const lockedIds = Array.isArray(config.lockedIds) ? config.lockedIds : [];

  assertIds("scope_ids", scopeIds || []);
  assertIds("default_ids", defaultIds);
  assertIds("locked_ids", lockedIds);

  if (defaultIds.length > MAX_BAND_TILES) {
    throw new AppError(
      "TOO_MANY_TILES",
      `A band is four tiles — the layout promise. Got ${defaultIds.length}.`,
      422,
    );
  }
  if (new Set(defaultIds).size !== defaultIds.length) {
    throw new AppError("DUP_TILE", "default_ids repeats a tile; the band has one of each.", 422);
  }
  const strayLocked = lockedIds.filter((id) => !defaultIds.includes(id));
  if (strayLocked.length) {
    throw new AppError(
      "LOCKED_NOT_DEFAULT",
      `Locked tiles must be part of the default band (locked without default: ${strayLocked.join(", ")}).`,
      422,
    );
  }
  const hiddenIds = defaultIds.concat(lockedIds).filter((id) => !LIVE_IDS.includes(id));
  if (hiddenIds.length) {
    throw new AppError(
      "KPI_NOT_LIVE",
      `Not available yet — the picker will offer these when their tiles ship: ${hiddenIds.join(", ")}.`,
      422,
    );
  }

  const { isCeo, live: eligible } = await eligibleForRole(client, roleId, roleRows[0].code);
  // NULL scope is the dynamic "everything this role can read" and is stored
  // as such — see the migration header for why a snapshot would freeze the
  // band against future tiles. An EXPLICIT scope is validated against what
  // the role can read: naming an unreadable tile is not yesterday's answer
  // here (the admin is writing today's), so it errors and teaches the
  // matrix-before-band ordering instead of silently dropping the entry.
  let cleanScope = null;
  if (scopeIds !== null) {
    const strays = scopeIds.filter((id) => !isCeo && !eligible.has(id));
    if (strays.length) {
      const needs = [...new Set(strays.map((id) => `${id} → ${BY_ID.get(id).module} (can_read)`))];
      throw new AppError(
        "KPI_NOT_READABLE",
        `This role cannot read the modules behind: ${needs.join(", ")}. Grant the module read access on the Permission matrix first — the matrix is decided before the band, never after.`,
        422,
      );
    }
    cleanScope = scopeIds;
  }
  const strayDefault = defaultIds.filter((id) => cleanScope !== null && !cleanScope.includes(id));
  if (strayDefault.length) {
    throw new AppError(
      "DEFAULT_OUT_OF_SCOPE",
      `default_ids must sit inside the role's scope (outside: ${strayDefault.join(", ")}).`,
      422,
    );
  }

  const after = await repo.upsert(client, {
    roleId,
    scopeIds: cleanScope,
    defaultIds,
    lockedIds,
  });
  await auditRoleChange(client, { actor, roleId, before, after });
  return after;
}

async function getForRole(client, roleId) {
  const { rows: roleRows } = await client.query(
    "SELECT role_id, code FROM role WHERE role_id = $1",
    [roleId],
  );
  if (!roleRows[0]) throw new AppError("ROLE_NOT_FOUND", "Role not found", 404);
  const config = await repo.get(client, roleId);
  const { live: eligible } = await eligibleForRole(client, roleId, roleRows[0].code);
  const { publicMeta } = require("../../dashboard/kpi_catalog");
  return {
    config: config
      ? {
          scopeIds: config.scope_ids,
          defaultIds: config.default_ids,
          lockedIds: config.locked_ids,
          updatedAt: config.updated_at,
        }
      : null,
    // The editor's candidate list, computed server-side for THIS role — the
    // same function that decides what its members' pickers hold at read time,
    // so the editor cannot offer a tile the band would hide.
    eligibleIds: [...eligible],
    liveIds: LIVE_IDS,
    // Display metadata travels here (not from the caller's own catalog read):
    // an admin configuring HR's band may not read payroll themselves, and the
    // editor must still LABEL what it offers them. The admin's GRANTS decide
    // nothing about what they may see named — only what members may see.
    tiles: require("../../dashboard/kpi_catalog").CATALOG.filter(
      (e) => e.status === "live" && eligible.has(e.id),
    ).map(publicMeta),
  };
}

/**
 * Grant-loss prune. Called by `permission.service` after any grant write that
 * leaves a role without `can_read` on a module — best-effort BY DESIGN: a
 * failed prune must not fail the grant write (revoking access is the security-
 * critical act; tidying a display row is not), and the read-time filter makes
 * a missed prune harmless for exactly one band paint (the tiles drop out of
 * the band anyway). Logged, never silent — the log line is what makes the
 * best-effort an intentional contract rather than a swallow.
 */
async function pruneUnreadable(client, roleId) {
  const row = await repo.get(client, roleId);
  if (!row) return null;
  const { live: eligible } = await eligibleForRole(client, roleId);
  const filter = (ids) => (ids || []).filter((id) => eligible.has(id));
  const next = {
    scopeIds: filter(row.scope_ids),
    defaultIds: filter(row.default_ids),
    lockedIds: filter(row.locked_ids),
  };
  const changed =
    next.scopeIds.length !== (row.scope_ids || []).length ||
    next.defaultIds.length !== (row.default_ids || []).length ||
    next.lockedIds.length !== (row.locked_ids || []).length;
  if (!changed) return null;
  if (!next.defaultIds.length && !next.scopeIds.length) {
    await repo.clear(client, roleId);
    return { cleared: true, removed: row };
  }
  await repo.replaceArrays(client, { roleId, ...next });
  return { cleared: false, removed: (row.default_ids || []).filter((id) => !next.defaultIds.includes(id)) };
}

async function auditRoleChange(client, { actor, roleId, before, after }) {
  await audit(client, {
    actorUserId: actor && actor.user_id ? actor.user_id : null,
    actorName: (actor && (actor.display_name || actor.email)) || null,
    actorEmail: (actor && actor.email) || null,
    action: "role.kpi_changed",
    moduleKey: "MOD-67",
    entityRef: `role:${roleId}`,
    before: before
      ? { scope_ids: before.scope_ids, default_ids: before.default_ids, locked_ids: before.locked_ids }
      : null,
    after: after
      ? { scope_ids: after.scope_ids, default_ids: after.default_ids, locked_ids: after.locked_ids }
      : null,
    isSensitive: false,
  });
}

module.exports = {
  getForRole,
  put,
  pruneUnreadable,
  eligibleForRole,
  /** The band resolver's read: configs for a user's roles, in merge order. */
  getConfigs: (client, roleIds) => repo.getForRoles(client, roleIds),
};
