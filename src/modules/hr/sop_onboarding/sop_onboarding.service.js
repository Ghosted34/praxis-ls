/**
 * SOP & onboarding (MOD-16). SOP documents with versioning: `newVersion`
 * supersedes the prior document (deactivates it and issues version n+1), so the
 * active set is always the current procedures. Method surface matches the shared
 * controller.
 */
"use strict";
const repo = require("./sop_onboarding.repo");
const events = require("./sop_onboarding.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "sop_document:" + id;

module.exports = {
  __entityMeta: { entity: "sop_onboarding", table: "sop_document", pk: "sop_document_id", activeColumn: "is_active" },

  list: (client, q) => repo.list(client, q),
  get: (client, id) => repo.findById(client, id),

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, { ...data, version_no: data.version_no || 1, is_active: data.is_active ?? true });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.sop_document_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.sop_document_id), after: row });
    return row;
  },

  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const row = await repo.update(client, id, patch);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },

  /** Supersede a SOP: deactivate the current version, issue version n+1. */
  async newVersion(client, { id, patch = {}, actor = {} }) {
    const current = await repo.findById(client, id);
    if (!current) throw new AppError("NOT_FOUND", "SOP not found", 404);
    await repo.update(client, id, { is_active: false });
    const next = await repo.insert(client, {
      title: patch.title || current.title,
      category: patch.category || current.category,
      vault_id: patch.vault_id || null,
      version_no: (current.version_no || 1) + 1,
      is_active: true,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(next.sop_document_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: "sop.new_version", moduleKey: events.MODULE, entityRef: ref(next.sop_document_id), before: current, after: next });
    return next;
  },

  async archive(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    await repo.update(client, id, { is_active: false });
    await client.query("INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)", [ref(id), before, actor.user_id || null]);
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
    return { archived: true, sop_document_id: id };
  },
};
