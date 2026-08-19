/**
 * Mailbox administration — a mailbox as an ORGANISATIONAL object rather than a
 * transport.
 *
 * mail.service owns connecting, testing, syncing and sending. This owns the
 * questions an administrator asks: whose mailbox is this, which team address does
 * it fulfil, who may work it, what happens when the person leaves, and how hard
 * may it be pushed before its host suspends it.
 *
 * ── THE ONE-PERSONAL-MAILBOX RULE ───────────────────────────────────────────
 *
 * Enforced by a partial unique index in 10723, not by this file. The check here
 * exists to turn a 23505 into a sentence a person can act on; if it is ever
 * skipped the database still refuses. That order matters — a rule that lives only
 * in a service is a convention, and conventions lose to a direct write.
 *
 * ── HANDOVER IS DELIBERATE, NEVER AUTOMATIC ─────────────────────────────────
 *
 * When somebody leaves, their mailbox is ARCHIVED: sync stops, it leaves the
 * workspace, the mail stays. It is NOT auto-converted into a shared mailbox,
 * because that would silently expose one person's correspondence to a team.
 * Converting it is a separate, named action with a confirmation and a ledger
 * entry, so a successor working the backlog is a decision somebody made.
 */
"use strict";

const repo = require("./mailbox.repo");
const access = require("./access");
const limits = require("./limits");
const { AppError } = require("../../../utils/errors");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { getSetting } = require("../../../shared/config/settings");

const MODULE = "MOD-72";
const ref = (id) => `email_connection:${id}`;

/** Tenant-wide mailbox defaults (10730, section `mail`). NULL on a row inherits these. */
const tenantLimits = (client) => getSetting(client, "mail", "limits", {});
const tenantPolicy = (client) => getSetting(client, "mail", "policy", {});

/* ── Catalogue ───────────────────────────────────────────────────────────── */

/**
 * The seven seeded team addresses plus anything the tenant added, each with the
 * mailbox that currently fulfils it (or none). This is what the admin screen
 * lists: slots first, mailboxes second, so an unconfigured tenant sees the shape
 * of what it should have rather than an empty table.
 */
async function listCatalogue(client, { includeDisabled = false } = {}) {
  const rows = await repo.listCatalogue(client, { includeDisabled });
  return rows.map((r) => ({
    catalogue_key: r.catalogue_key,
    label_en: r.label_en, label_fr: r.label_fr,
    description_en: r.description_en, description_fr: r.description_fr,
    suggested_local_part: r.suggested_local_part,
    department: r.department, feeds: r.feeds || [],
    sort_order: r.sort_order, is_system: r.is_system, is_enabled: r.is_enabled,
    configured: Boolean(r.email_connection_id),
    email_connection_id: r.email_connection_id || null,
    email_address: r.email_address || null,
    connection_status: r.connection_status || null,
  }));
}

/** Add a team address the seeded seven do not cover. */
async function addCatalogueEntry(client, input = {}, actor = {}) {
  const key = String(input.catalogue_key || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!key) throw new AppError("VALIDATION_ERROR", "catalogue_key is required", 422);
  if (await repo.getCatalogueEntry(client, key)) {
    throw new AppError("ALREADY_EXISTS", `A shared mailbox type '${key}' already exists.`, 409);
  }
  const row = await repo.upsertCatalogueEntry(client, {
    catalogue_key: key,
    label_en: input.label_en || key,
    label_fr: input.label_fr || input.label_en || key,
    suggested_local_part: (input.suggested_local_part || key.toLowerCase()).replace(/[^a-z0-9._-]/g, ""),
    description_en: input.description_en || null,
    description_fr: input.description_fr || null,
    department: input.department || null,
    sort_order: Number(input.sort_order) || 500,
    is_system: false,
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.catalogue.added",
    moduleKey: MODULE, entityRef: `mail_shared_catalogue:${key}`, after: row,
  });
  return row;
}

async function setCatalogueEnabled(client, key, isEnabled, actor = {}) {
  const entry = await repo.getCatalogueEntry(client, key);
  if (!entry) throw new AppError("NOT_FOUND", "shared mailbox type not found", 404);
  const row = await repo.updateCatalogueEntry(client, key, { is_enabled: Boolean(isEnabled) });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.catalogue.toggled",
    moduleKey: MODULE, entityRef: `mail_shared_catalogue:${key}`,
    before: { is_enabled: entry.is_enabled }, after: { is_enabled: Boolean(isEnabled) },
  });
  return row;
}

/* ── Listing ─────────────────────────────────────────────────────────────── */

/** The administration inventory: every mailbox, with health resolved. */
async function listAll(client, q = {}) {
  const [rows, defaults] = await Promise.all([
    repo.listAll(client, { kind: q.kind || null, includeArchived: q.include_archived === true || q.include_archived === "true" }),
    tenantLimits(client),
  ]);
  return rows.map((r) => ({
    ...r,
    health: limits.health(r),
    effective_limits: limits.effectiveLimits(r, defaults),
  }));
}

/** What one person can actually open: their personal mailbox and their grants. */
async function listForUser(client, userId) {
  const rows = await repo.listForUser(client, userId);
  return rows.map((r) => ({ ...r, health: limits.health(r) }));
}

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

/**
 * Refuse a second personal mailbox with a sentence rather than a constraint
 * violation. The index is the real enforcement; this is the manners.
 */
async function assertNoPersonalMailbox(client, userId) {
  const existing = await repo.personalFor(client, userId);
  if (existing) {
    throw new AppError(
      "PERSONAL_MAILBOX_EXISTS",
      `You already have a personal mailbox (${existing.email_address}). Each person has one. Edit that mailbox to change its address, or ask an administrator to set up a shared mailbox if you need a second address.`,
      409,
      { email_address: existing.email_address, email_connection_id: existing.email_connection_id },
    );
  }
}

/**
 * Classify a freshly created connection. mail.service.connect writes the
 * transport row; this stamps what KIND of thing it is, which is the part
 * administration cares about.
 */
async function classify(client, connectionId, { kind, catalogueKey = null, entityId = null, department = null, actor = {} }) {
  const policy = await tenantPolicy(client);
  const visibility = kind === "SHARED"
    ? (policy.shared_default_visibility || "TEAM")
    : (policy.personal_default_visibility || "PRIVATE");

  const patch = { kind, visibility, catalogue_key: catalogueKey, entity_id: entityId, department };
  const row = await repo.updateConnection(client, connectionId, patch);

  // The creator of a shared mailbox manages it from the start; otherwise the
  // person who just set it up cannot add anybody to it.
  if (kind === "SHARED" && actor.user_id) {
    await access.grant(client, { connectionId, userId: actor.user_id, role: "MANAGER", actor });
  }
  await emitEvent(client, {
    eventTypeKey: "mailbox.connected", moduleKey: MODULE, entityRef: ref(connectionId),
    actorUserId: actor.user_id || null,
    payload: { kind, catalogue_key: catalogueKey, address: row && row.email_address },
  });
  return row;
}

/**
 * Retire a mailbox. Sync stops and it disappears from the workspace; every live
 * grant is withdrawn; the mail is untouched.
 */
async function archive(client, id, actor = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  if (conn.status === "ARCHIVED") return conn;

  const row = await repo.updateConnection(client, id, {
    status: "ARCHIVED", archived_at: new Date(), is_default: false,
  });
  const members = await repo.listMembers(client, id);
  const revokedBy = await resolveActorId(client, actor.user_id);
  for (const m of members) await repo.revokeMember(client, id, m.user_id, revokedBy);

  await repo.recordAccessAudit(client, {
    email_connection_id: id, action: "MAILBOX_ARCHIVED",
    subject_user_id: conn.owner_user_id || null, actor_user_id: actor.user_id || null,
    detail: { address: conn.email_address, revoked_grants: members.length },
  });
  await emitEvent(client, {
    eventTypeKey: "mailbox.archived", moduleKey: MODULE, entityRef: ref(id),
    actorUserId: actor.user_id || null,
    payload: { address: conn.email_address, revoked_grants: members.length },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mailbox.archived",
    moduleKey: MODULE, entityRef: ref(id),
    before: { status: conn.status }, after: { status: "ARCHIVED" }, isSensitive: true,
  });
  return row;
}

/**
 * Convert a personal mailbox into a shared one so a team can work its backlog.
 *
 * Deliberately explicit: this takes one person's correspondence and shows it to a
 * group. It is the right thing when somebody leaves and a successor has to answer
 * their clients, and the wrong thing to do by accident, so it is a named action
 * with a ledger entry naming who did it and to whom.
 */
async function handover(client, id, { catalogueKey = null, department = null, actor = {} } = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  if (conn.kind !== "PERSONAL") throw new AppError("NOT_PERSONAL", "Only a personal mailbox can be handed over.", 422);
  if (catalogueKey) {
    const entry = await repo.getCatalogueEntry(client, catalogueKey);
    if (!entry) throw new AppError("NOT_FOUND", "shared mailbox type not found", 404);
    const taken = await repo.connectionForCatalogue(client, catalogueKey);
    if (taken) throw new AppError("CATALOGUE_TAKEN", `${entry.label_en} is already fulfilled by ${taken.email_address}.`, 409);
  }
  const policy = await tenantPolicy(client);
  const row = await repo.updateConnection(client, id, {
    kind: "SHARED",
    visibility: policy.shared_default_visibility || "TEAM",
    catalogue_key: catalogueKey,
    department: department || conn.department || null,
    is_default: false,
  });
  if (actor.user_id) {
    await access.grant(client, { connectionId: id, userId: actor.user_id, role: "MANAGER", actor });
  }
  await repo.recordAccessAudit(client, {
    email_connection_id: id, action: "MAILBOX_HANDOVER",
    subject_user_id: conn.owner_user_id || null, actor_user_id: actor.user_id || null,
    detail: { address: conn.email_address, catalogue_key: catalogueKey, previous_owner: conn.owner_user_id },
  });
  await emitEvent(client, {
    eventTypeKey: "mailbox.handover", moduleKey: MODULE, entityRef: ref(id),
    actorUserId: actor.user_id || null,
    payload: { address: conn.email_address, previous_owner: conn.owner_user_id, catalogue_key: catalogueKey },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mailbox.handover",
    moduleKey: MODULE, entityRef: ref(id),
    before: { kind: "PERSONAL", owner_user_id: conn.owner_user_id },
    after: { kind: "SHARED", catalogue_key: catalogueKey }, isSensitive: true,
  });
  return row;
}

/**
 * Everything mail-related that must happen when somebody leaves: their personal
 * mailbox is archived and every shared-mailbox grant they held is withdrawn.
 * Idempotent, so it is safe to call from an offboarding flow that may retry.
 */
async function offboardUser(client, userId, actor = {}) {
  const personal = await repo.personalFor(client, userId);
  if (personal) await archive(client, personal.email_connection_id, actor);
  const revoked = await repo.revokeAllForUser(client, userId, await resolveActorId(client, actor.user_id));
  for (const r of revoked) {
    await repo.recordAccessAudit(client, {
      email_connection_id: r.email_connection_id, action: "REVOKED",
      subject_user_id: userId, actor_user_id: actor.user_id || null,
      detail: { reason: "offboarding" },
    });
  }
  return { archived_personal: Boolean(personal), grants_revoked: revoked.length };
}

/* ── Limits ──────────────────────────────────────────────────────────────── */

async function setLimits(client, id, patch = {}, actor = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  const fields = {};
  for (const k of ["send_limit_hourly", "send_limit_daily", "sync_depth_days"]) {
    if (patch[k] !== undefined) fields[k] = patch[k] === null || patch[k] === "" ? null : Number(patch[k]);
  }
  if (!Object.keys(fields).length) return conn;
  const row = await repo.updateConnection(client, id, fields);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mailbox.limits.changed",
    moduleKey: MODULE, entityRef: ref(id),
    before: { send_limit_hourly: conn.send_limit_hourly, send_limit_daily: conn.send_limit_daily, sync_depth_days: conn.sync_depth_days },
    after: fields,
  });
  return row;
}

/**
 * May this mailbox send `count` more messages right now?
 *
 * Answers with a verdict rather than a boolean so the caller can tell the user
 * WHEN instead of just no — "3 messages queued, sending from 14:00" is a state
 * people accept; a bare failure sends them back to Outlook.
 */
async function checkSendAllowance(client, connectionId, count = 1, at = new Date()) {
  const [conn, defaults] = await Promise.all([repo.getConnection(client, connectionId), tenantLimits(client)]);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  const eff = limits.effectiveLimits(conn, defaults);
  const start = limits.windowStart(at);
  const counts = await repo.sendCounts(client, connectionId, start);
  return { ...limits.decide({ hourlyUsed: counts.hourly, dailyUsed: counts.daily, limits: eff, at, count }), limits: eff, used: counts };
}

/** Record that `count` messages went out, so the next allowance check is right. */
const recordSent = (client, connectionId, count = 1, at = new Date()) =>
  repo.bumpSendWindow(client, connectionId, limits.windowStart(at), count);

/** Health inputs a sync writes back, so the indicator reflects reality. */
const markSyncSuccess = (client, id) => repo.clearFailures(client, id);
const markSyncFailure = (client, id, message) => repo.bumpFailure(client, id, message);

module.exports = {
  MODULE,
  listCatalogue, addCatalogueEntry, setCatalogueEnabled,
  listAll, listForUser,
  assertNoPersonalMailbox, classify, archive, handover, offboardUser,
  setLimits, checkSendAllowance, recordSent, markSyncSuccess, markSyncFailure,
  tenantLimits, tenantPolicy,
};
