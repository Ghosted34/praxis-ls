/**
 * A tiny CRUD kit for the master-data REGISTRIES — client_type, supplier_type,
 * party_document_type (spec §6). They are the same shape (a code/name row a
 * tenant can add to, with system rows that deactivate but never delete), so the
 * repo, service and controller are built once here and each module is a
 * three-line wrapper.
 *
 * The `_shared` folder starts with an underscore, so the module loader's
 * `NAME_RE` skips it — this is a helper, not a mounted module.
 *
 * MASS ASSIGNMENT is closed by the `writable` allow-list each module passes:
 * insertOne/updateOne reject any key outside it (so a request cannot set
 * `is_system` and mint a system type), and — because the list lives in the
 * module's `<name>.repo.js` — it is also what satisfies the write-route CI gate
 * without a separate zod validator on every registry route.
 */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const { audit } = require("../../../shared/events/emit");
const { asyncHandler, AppError } = require("../../../utils/errors");

const actorOf = (req) => req.user || { user_id: null };

/**
 * @param {object} cfg
 * @param {string} cfg.table      registry table name (code-provided literal)
 * @param {string} cfg.pk         primary-key column
 * @param {string} cfg.moduleKey  RBAC module for the audit trail
 * @param {string} cfg.label      entity label used in audit refs and errors
 * @param {string[]} cfg.writable body-writable columns (the allow-list)
 */
function build({ table, pk, moduleKey, label, writable }) {
  const repo = {
    writable,
    insert: (c, data) => insertOne(c, table, data, "*", writable),
    get: (c, id) => getById(c, table, pk, id),
    update: (c, id, fields) => updateOne(c, table, pk, id, fields, "*", writable),
    remove: (c, id) => c.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [id]),
    async list(c, q = {}) {
      const { limit, offset } = page(q);
      const params = [limit, offset];
      const wh = [];
      if (q.active !== undefined) { params.push(q.active === "true" || q.active === true); wh.push(`is_active = $${params.length}`); }
      if (q.applies_to) { params.push(String(q.applies_to).toUpperCase()); wh.push(`(applies_to = $${params.length} OR applies_to = 'BOTH')`); }
      if (q.q) { params.push(`%${q.q}%`); wh.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`); }
      const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
      const { rows } = await c.query(`SELECT * FROM ${table} ${where} ORDER BY code LIMIT $1 OFFSET $2`, params);
      return rows;
    },
  };

  const service = {
    get: (c, id) => repo.get(c, id),
    list: (c, q) => repo.list(c, q),
    async create(c, { data, actor = {} }) {
      if (!data || !data.code || !data.name) throw new AppError("VALIDATION_ERROR", "code and name are required", 422, { code: ["required"], name: ["required"] });
      await c.query("BEGIN");
      try {
        const row = await repo.insert(c, data);
        await audit(c, { actorUserId: actor.user_id || null, action: `${label}.created`, moduleKey, entityRef: `${label}:${row[pk]}`, after: row });
        await c.query("COMMIT");
        return row;
      } catch (e) {
        await c.query("ROLLBACK");
        if (e.code === "23505") throw new AppError("EXISTS", `${label} "${data.code}" already exists`, 409);
        throw e;
      }
    },
    async update(c, { id, patch, actor = {} }) {
      const before = await repo.get(c, id);
      if (!before) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      const row = await repo.update(c, id, patch);
      await audit(c, { actorUserId: actor.user_id || null, action: `${label}.updated`, moduleKey, entityRef: `${label}:${id}`, before, after: row });
      return row;
    },
    async remove(c, { id, actor = {} }) {
      const before = await repo.get(c, id);
      if (!before) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      // System rows deactivate, never delete (§6.2). A tenant row deletes unless
      // it is referenced, in which case the FK turns it into a deactivate too.
      if (before.is_system) throw new AppError("SYSTEM_TYPE", "A system type can be deactivated but not deleted.", 422);
      await c.query("BEGIN");
      try {
        await repo.remove(c, id);
        await audit(c, { actorUserId: actor.user_id || null, action: `${label}.deleted`, moduleKey, entityRef: `${label}:${id}`, before });
        await c.query("COMMIT");
        return { deleted: true, id };
      } catch (e) {
        await c.query("ROLLBACK");
        if (e.code === "23503") throw new AppError("REFERENCED", `${label} is in use — deactivate it instead of deleting.`, 409);
        throw e;
      }
    },
  };

  const controller = {
    list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
    get: asyncHandler(async (req, res) => {
      const r = await req.tenantDb((c) => service.get(c, req.params.id));
      if (!r) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: r });
    }),
    create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data: req.body, actor: actorOf(req) })) })),
    update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actorOf(req) })) })),
    remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actorOf(req) })) })),
  };

  return { repo, service, controller };
}

module.exports = { build };
