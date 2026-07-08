/**
 * Resource kit — composable CRUD builders so each module's 6 files stay thin but
 * explicit (per doc/CONVENTIONS.md). A module wires: repo = makeRepo(cfg);
 * service = makeService({repo, ...}); controller = makeController(service);
 * router = makeRouter({controller, validator}). Modules add domain logic on top.
 */
"use strict";

const { insertOne, updateOne, getById, page } = require("../db/query-helpers");
const { emitEvent, audit } = require("../events/emit");
const { asyncHandler, AppError } = require("../../utils/errors");
const express = require("express");

/** cfg: { table, pk, activeColumn?, searchColumn?, orderBy?, scopeColumn? }
 *  scopeColumn is the record-level-scope opt-in (see doc/WORK_DONE.md /
 *  middleware/rbac.js): if set, list() filters by it whenever the caller
 *  passes a non-null scopeIds array (req.scope_ids from requirePermission).
 *  Not set (the default, and every existing module today) → no behavior
 *  change at all. */
function makeRepo(cfg) {
  const orderBy = cfg.orderBy || "created_at DESC";
  return {
    cfg,
    async list(client, q = {}, scopeIds = null) {
      const { limit, offset } = page(q);
      const params = [limit, offset];
      const wh = [];
      if (cfg.activeColumn) wh.push(`${cfg.activeColumn} = true`);
      if (cfg.searchColumn && q.q) {
        params.push(`%${q.q}%`);
        wh.push(`${cfg.searchColumn} ILIKE $${params.length}`);
      }
      if (cfg.scopeColumn && scopeIds) {
        params.push(scopeIds);
        wh.push(`${cfg.scopeColumn} = ANY($${params.length}::uuid[])`);
      }
      const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
      const { rows } = await client.query(
        `SELECT * FROM ${cfg.table} ${where} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
        params,
      );
      return rows;
    },
    findById: (client, id) => getById(client, cfg.table, cfg.pk, id),
    create: (client, data) => insertOne(client, cfg.table, data),
    update: (client, id, patch) => updateOne(client, cfg.table, cfg.pk, id, patch),
    setActive: (client, id, v) =>
      cfg.activeColumn ? updateOne(client, cfg.table, cfg.pk, id, { [cfg.activeColumn]: v }) : null,
  };
}

/** opts: { repo, moduleKey, entity, events:{CREATED,UPDATED,ARCHIVED}, beforeCreate? } */
function makeService(opts) {
  const { repo, moduleKey, entity, events } = opts;
  const ref = (row) => `${entity}:${row[repo.cfg.pk]}`;
  return {
    // Read by shared/crud/entity-registry.js — lets soft-delete restore
    // find the real table for an entity_ref prefix without guessing.
    __entityMeta: {
      entity,
      table: repo.cfg.table,
      pk: repo.cfg.pk,
      activeColumn: repo.cfg.activeColumn || null,
    },
    list: (client, q, scopeIds) => repo.list(client, q, scopeIds),
    get: (client, id) => repo.findById(client, id),
    async create(client, { data, actor }) {
      const payload = opts.beforeCreate ? opts.beforeCreate(data) : data;
      const row = await repo.create(client, payload);
      await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey, entityRef: ref(row), actorUserId: actor.user_id });
      await audit(client, { actorUserId: actor.user_id, action: events.CREATED, moduleKey, entityRef: ref(row), after: row });
      return row;
    },
    async update(client, { id, patch, actor }) {
      const before = await repo.findById(client, id);
      if (!before) return null;
      const row = await repo.update(client, id, patch);
      await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey, entityRef: ref(before), actorUserId: actor.user_id });
      await audit(client, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey, entityRef: ref(before), before, after: row });
      return row;
    },
    async archive(client, { id, actor }) {
      const before = await repo.findById(client, id);
      if (!before) return null;
      if (repo.cfg.activeColumn) await repo.setActive(client, id, false);
      await client.query(
        "INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)",
        [ref(before), before, actor.user_id],
      );
      await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey, entityRef: ref(before), actorUserId: actor.user_id });
      await audit(client, { actorUserId: actor.user_id, action: events.ARCHIVED, moduleKey, entityRef: ref(before), before });
      return { archived: true, [repo.cfg.pk]: id };
    },
  };
}

function makeController(service, label = "Record") {
  const actor = (req) => req.user || { user_id: null };
  return {
    list: asyncHandler(async (req, res) =>
      res.json({ data: await req.tenantDb((c) => service.list(c, req.query, req.scope_ids ?? null)) }),
    ),
    get: asyncHandler(async (req, res) => {
      const row = await req.tenantDb((c) => service.get(c, req.params.id));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
    create: asyncHandler(async (req, res) =>
      res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
    update: asyncHandler(async (req, res) => {
      const row = await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
    archive: asyncHandler(async (req, res) => {
      const row = await req.tenantDb((c) => service.archive(c, { id: req.params.id, actor: actor(req) }));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
  };
}

/** validator: { create, update } express middlewares (optional). */
function makeRouter({ controller, validator = {}, softDeletable = true }) {
  const r = express.Router();
  r.get("/", controller.list);
  r.post("/", ...(validator.create ? [validator.create] : []), controller.create);
  r.get("/:id", controller.get);
  r.patch("/:id", ...(validator.update ? [validator.update] : []), controller.update);
  if (softDeletable) r.delete("/:id", controller.archive);
  return r;
}

module.exports = { makeRepo, makeService, makeController, makeRouter };
