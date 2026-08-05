/**
 * Resource kit — composable CRUD builders so each module's 6 files stay thin but
 * explicit (per doc/CONVENTIONS.md). A module wires: repo = makeRepo(cfg);
 * service = makeService({repo, ...}); controller = makeController(service);
 * router = makeRouter({controller, validator}). Modules add domain logic on top.
 */
"use strict";

const { insertOne, updateOne, getById, page, TOTAL_COL, splitTotal, ident } = require("../db/query-helpers");
const { atomically } = require("../db/tx");
const { emitEvent, audit } = require("../events/emit");
const { asyncHandler, AppError } = require("../../utils/errors");
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");

/** cfg: { table, pk, activeColumn?, searchColumn?, orderBy?, scopeColumn? }
 *  scopeColumn is the record-level-scope opt-in (see doc/WORK_DONE.md /
 *  middleware/rbac.js): if set, list() filters by it whenever the caller
 *  passes a non-null scopeIds array (req.scope_ids from requirePermission).
 *  Not set (the default, and every existing module today) → no behavior
 *  change at all. */
/**
 * Resolve `?sort=` into a safe ORDER BY (API F-29).
 *
 * Sorting was not exposed anywhere: order was fixed at config time, so every
 * consumer wanting a different order had to fetch and sort client-side — and by
 * F-26/F-27 that meant sorting a truncated 50-row window, i.e. sorting the
 * wrong rows.
 *
 * `cfg.sortable` is an explicit allow-list of column names. Without one the
 * parameter is refused rather than ignored, because an ORDER BY built from
 * user input is precisely the injection this codebase spent SEC H3 closing.
 *
 * Syntax: `?sort=created_at` or `?sort=-created_at` for descending, mirroring
 * the widely-used JSON:API convention.
 */
function resolveSort(cfg, q, fallback) {
  if (!q || q.sort === undefined || q.sort === "") return fallback;
  const raw = String(q.sort);
  const desc = raw.startsWith("-");
  const col = desc ? raw.slice(1) : raw;
  const allowed = cfg.sortable || [];
  if (!allowed.includes(col)) {
    throw new AppError(
      "INVALID_SORT",
      allowed.length
        ? `Cannot sort by "${col}". Sortable fields: ${allowed.join(", ")}.`
        : `Sorting is not available on this resource.`,
      422,
      { sort: [`unsupported sort field "${col}"`] },
    );
  }
  return `${ident(col)} ${desc ? "DESC" : "ASC"}`;
}

/**
 * Reject an unrecognised filter instead of silently dropping it (API F-28).
 *
 * Unknown query keys used to be ignored, so `?stat=OPEN` returned the unfiltered
 * list and looked like it had worked — a typo in a filter silently widened the
 * result set, which on a permissions or receivables screen means showing rows
 * the caller meant to exclude.
 *
 * Only enforced when `cfg.filterable` is declared, so a module that has not
 * been through this yet behaves exactly as before. `limit`, `offset`, `q` and
 * `sort` are always accepted — they are the shared list vocabulary.
 */
const LIST_PARAMS = new Set(["limit", "offset", "q", "sort"]);

function assertKnownFilters(cfg, q) {
  if (!cfg.filterable || !q) return;
  const allowed = new Set([...cfg.filterable, ...LIST_PARAMS]);
  const bad = Object.keys(q).filter((k) => !allowed.has(k));
  if (bad.length) {
    throw new AppError(
      "UNKNOWN_FILTER",
      `${bad.length === 1 ? "Filter" : "Filters"} ${bad.map((b) => `"${b}"`).join(", ")} `
      + `${bad.length === 1 ? "is" : "are"} not supported here. `
      + `Available: ${[...cfg.filterable].sort().join(", ") || "none"}.`,
      422,
      bad.reduce((a, b) => ({ ...a, [b]: ["unknown filter"] }), {}),
    );
  }
}

function makeRepo(cfg) {
  const orderBy = cfg.orderBy || "created_at DESC";
  return {
    cfg,
    async list(client, q = {}, scopeIds = null) {
      assertKnownFilters(cfg, q);
      const order = resolveSort(cfg, q, orderBy);
      const { limit, offset } = page(q);
      const params = [limit, offset];
      const wh = [];
      if (cfg.activeColumn) wh.push(`${cfg.activeColumn} = true`);
      if (cfg.searchColumn && q.q) {
        params.push(`%${q.q}%`);
        wh.push(`${cfg.searchColumn} ILIKE $${params.length}`);
      }
      // Record-level scope. `scopeIds` is the caller's scope CLOSURE (their
      // nodes plus everything beneath — middleware/rbac.js), so a manager at HQ
      // sees the branches under it; null means they have no assignment at all
      // and are unrestricted, which is the pre-existing behaviour.
      //
      // A row with a NULL scope is visible to everyone, deliberately. Most
      // records predate the organigramme and were never assigned to a part of
      // the company; excluding them would make a scoped user's list abruptly
      // empty, which is a far worse failure than showing an unassigned record to
      // someone who shouldn't care about it. Assign the record to narrow it.
      if (cfg.scopeColumn && scopeIds) {
        params.push(scopeIds);
        wh.push(`(${cfg.scopeColumn} IS NULL OR ${cfg.scopeColumn} = ANY($${params.length}::uuid[]))`);
      }
      const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
      // API F-26. `page()` clamps every list to 50 rows and NOTHING told the
      // caller there were more — 202 collection GETs returned a bare array with
      // no count, cursor or has_more. So every list screen in the product showed
      // at most the 50 most recent rows and presented them as the whole set: a
      // tenant with 300 clients saw 50 and no indication of the rest.
      //
      // COUNT(*) OVER() gets the pre-LIMIT total in the SAME query — one round
      // trip, one WHERE clause. A separate SELECT COUNT(*) would duplicate the
      // filter and the two copies would drift.
      const { rows } = await client.query(
        `SELECT *, ${TOTAL_COL} FROM ${cfg.table} ${where} ORDER BY ${order} LIMIT $1 OFFSET $2`,
        params,
      );
      const split = splitTotal(rows);
      // The total rides on a NON-ENUMERABLE property rather than changing the
      // return type. `repo.list` is called from 90 modules and by services that
      // treat the result as an array; returning `{ rows, total }` instead would
      // be a breaking change in 90 places at once. Non-enumerable means
      // JSON.stringify, Object.keys and spread all still see a plain array —
      // only makeController, which knows to look, reads it.
      Object.defineProperty(split.rows, "_total", { value: split.total, enumerable: false });
      Object.defineProperty(split.rows, "_page", {
        value: { limit, offset }, enumerable: false,
      });
      return split.rows;
    },
    findById: (client, id) => getById(client, cfg.table, cfg.pk, id),
    // SEC H3: `cfg.writable`, when declared, is the ONLY set of columns a
    // request body may write. Modules on the passthrough validator get their
    // body through untouched, so without this an MOD-67 `edit` grant reaches
    // every column of the table — including killed_at on user_session and
    // user_id on anything.
    create: (client, data) => insertOne(client, cfg.table, data, "*", cfg.writable || null),
    update: (client, id, patch) => updateOne(client, cfg.table, cfg.pk, id, patch, "*", cfg.writable || null),
    // setActive is code-driven, not body-driven — the column comes from cfg —
    // so it deliberately bypasses the allow-list, which would otherwise force
    // every module to list its own activeColumn as writable by a request.
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
      // DATA 5.2: business row + event + audit are ONE unit.
      return atomically(client, async () => {
        const payload = opts.beforeCreate ? opts.beforeCreate(data) : data;
        const row = await repo.create(client, payload);
        await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey, entityRef: ref(row), actorUserId: actor.user_id });
        await audit(client, { actorUserId: actor.user_id, action: events.CREATED, moduleKey, entityRef: ref(row), after: row });
        return row;
      });
    },
    async update(client, { id, patch, actor }) {
      return atomically(client, async () => {
        const before = await repo.findById(client, id);
        if (!before) return null;
        const row = await repo.update(client, id, patch);
        await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey, entityRef: ref(before), actorUserId: actor.user_id });
        await audit(client, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey, entityRef: ref(before), before, after: row });
        return row;
      });
    },
    /**
     * `deleteMode` (audit finding A5), default "soft":
     *
     *   soft   deactivate if the table has an active column, otherwise record
     *          the deletion and leave the row. Right for business records, which
     *          are referenced by ledgers and documents and must not vanish.
     *
     *   hard   record the deletion, then actually DELETE. Right for CONFIGURATION
     *          — a role, a grant, a capability, a scope. On a table with no
     *          active column the soft path removed nothing at all, so the
     *          security UI reported success and changed nothing: an admin who
     *          revoked a grant had not. That is the bug this mode exists for.
     *
     * The soft_delete row is written in BOTH modes, so a hard delete is still
     * recoverable through the audit ledger's restore path and still carries
     * maker-checker.
     */
    async archive(client, { id, actor }) {
      // DATA 5.2: the soft_delete row, the DELETE, the event and the audit are
      // one unit. The ordering reasoning below is kept because it is still
      // correct — but it is no longer load-bearing, because a failure now rolls
      // the whole thing back instead of stranding a soft_delete row that
      // asserts a deletion which never happened.
      return atomically(client, async () => {
      const before = await repo.findById(client, id);
      if (!before) return null;
      if (repo.cfg.activeColumn) await repo.setActive(client, id, false);
      // deleted_by is `REFERENCES app_user(user_id)` in the schema being written
      // to. Under TEST that's the SANDBOX schema, while the user's row lives in
      // LIVE (identity pinned, session 3) — so a raw id raises 23503 and kills
      // the archive. Same guard as shared/events/emit.js: record the deletion,
      // drop the attribution when it can't be validated.
      //
      // NOTE this weakens maker-checker in that case: the CHECK
      // (restored_by <> deleted_by) can't catch a self-restore when deleted_by
      // is NULL. Acceptable in sandbox, where there are no real users to check
      // between; in LIVE the id always resolves and the guarantee is unchanged.
      await client.query(
        "INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) " +
          "SELECT $1,$2,(SELECT user_id FROM app_user WHERE user_id = $3)",
        [ref(before), before, actor.user_id],
      );
      // Hard delete AFTER the soft_delete row and BEFORE the event/audit writes,
      // so the record of what was removed exists even if the delete then fails a
      // foreign key — and so the audit entry describes something that really is
      // gone.
      let removed = false;
      if (opts.deleteMode === "hard" && !repo.cfg.activeColumn) {
        const { rowCount } = await client.query(
          `DELETE FROM ${repo.cfg.table} WHERE ${repo.cfg.pk} = $1`,
          [id],
        );
        removed = rowCount > 0;
      }

      await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey, entityRef: ref(before), actorUserId: actor.user_id });
      // DATA 6.3: this passed `before` only, so the ledger recorded what the
      // record WAS and never what it became — an archive entry that cannot
      // answer "was it deactivated or actually deleted?". Both states now.
      const after = removed
        ? null
        : (repo.cfg.activeColumn ? await repo.findById(client, id) : before);
      await audit(client, {
        actorUserId: actor.user_id, action: events.ARCHIVED, moduleKey,
        entityRef: ref(before), before, after,
      });
      return { archived: true, deleted: removed, [repo.cfg.pk]: id };
      });
    },
  };
}

/**
 * opts: { identity?: boolean } — when identity:true the CRUD runs against the
 * env-independent LIVE/identity schema (req.identityDb) instead of the
 * env-selected business schema (req.tenantDb). Used by the RBAC/identity modules
 * (roles, permissions, capabilities, scopes, field-visibility, sessions) so
 * they behave identically under LIVE and TEST. See middleware/tenant-context.js.
 */
function makeController(service, label = "Record", opts = {}) {
  const actor = (req) => req.user || { user_id: null };
  const db = (req) => (opts.identity && req.identityDb ? req.identityDb : req.tenantDb);
  return {
    /**
     * API F-26. `data` stays a bare array — changing it to an object would
     * break every consumer, and `api-client.ts` returns `json.data` directly.
     * `meta` is a NEW TOP-LEVEL KEY, which the existing client ignores, so this
     * is additive: old callers are unaffected and new ones can finally page.
     *
     * `meta` is omitted when the service does not report a total (a module with
     * a hand-rolled `list` that does not go through the shared repo). Emitting
     * `total: 0` there would be a lie, and a client that trusted it would show
     * an empty pager over a full list.
     */
    list: asyncHandler(async (req, res) => {
      const rows = await db(req)((c) => service.list(c, req.query, req.scope_ids ?? null));
      const total = rows && rows._total;
      if (typeof total !== "number") return res.json({ data: rows });
      const { limit, offset } = rows._page || {};
      return res.json({
        data: rows,
        meta: { total, limit, offset, has_more: offset + rows.length < total },
      });
    }),
    get: asyncHandler(async (req, res) => {
      const row = await db(req)((c) => service.get(c, req.params.id));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
    create: asyncHandler(async (req, res) =>
      res.status(201).json({ data: await db(req)((c) => service.create(c, { data: req.body, actor: actor(req) })) })),
    update: asyncHandler(async (req, res) => {
      const row = await db(req)((c) => service.update(c, { id: req.params.id, patch: req.body, actor: actor(req) }));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
    archive: asyncHandler(async (req, res) => {
      const row = await db(req)((c) => service.archive(c, { id: req.params.id, actor: actor(req) }));
      if (!row) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      res.json({ data: row });
    }),
  };
}

/**
 * Generic CRUD router. GATED BY DEFAULT: authMiddleware runs first (no anonymous
 * access), and when `module` (a MOD-xx key) is given each verb also carries the
 * matching requirePermission (view/create/edit/delete). Pass `gated: false` only
 * for a router that applies its own auth upstream. This closes the class of hole
 * where a bare makeRouter() exposed a fully-open surface.
 *   validator: { create, update } express middlewares (optional).
 */
function makeRouter({ controller, validator = {}, softDeletable = true, module = null, gated = true }) {
  const r = express.Router();
  if (gated) r.use(authMiddleware);
  const perm = (action) => (module ? [requirePermission(module, action)] : []);
  r.get("/", ...perm("view"), controller.list);
  r.post("/", ...perm("create"), ...(validator.create ? [validator.create] : []), controller.create);
  r.get("/:id", ...perm("view"), controller.get);
  r.patch("/:id", ...perm("edit"), ...(validator.update ? [validator.update] : []), controller.update);
  if (softDeletable) r.delete("/:id", ...perm("delete"), controller.archive);
  return r;
}

module.exports = { makeRepo, makeService, makeController, makeRouter };
