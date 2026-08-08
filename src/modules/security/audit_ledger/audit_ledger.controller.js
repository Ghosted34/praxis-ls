"use strict";
const { asyncHandler, AppError } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./audit_ledger.service");
const { resolveEntityLabel } = require("./entity-label");

// Base CRUD + soft-delete restore stay ENV-scoped: soft_delete rows and the
// business records they restore are per-environment business data.
const crud = makeController(service, "Audit entry");

// GET /audit/:id — overrides crud.get (below `list` stays the generic one).
//
// WHY THIS ISN'T crud.get. makeController's default `db(req)` is always
// req.tenantDb unless the WHOLE controller opts into `{ identity: true }` —
// but a single ledger row can live in EITHER schema depending on what wrote
// it. Auth/RBAC events (login, logout, password reset, 2FA, permission/role/
// capability changes) are identity-pinned and always write via req.identityDb
// (see middleware/tenant-context.js), while ordinary business writes (an
// invoice, a corporate entity, a vacancy) go through req.tenantDb. myFeed
// (below) already queries BOTH schemas and merges them for the list — but
// this single-row fetch only ever checked req.tenantDb, so opening any
// identity-schema row from that merged list 404'd as "Audit entry not
// found" even though the list had just shown it.
//
// `?scope=identity|tenant` (set by the client from the `ledger_scope` myFeed
// now tags each row with) picks the right schema on the first try. Without
// it — an older cached client, or a direct API call — fall back to the OTHER
// schema before giving up, so a hint-less caller still finds the row instead
// of always 404ing on identity-side events. NOTE: ledger_id is a per-schema
// serial, so the two schemas' ids CAN collide; that ambiguity is only
// possible on this no-hint fallback path — the scope-hinted primary lookup
// (the only path the shipped frontend takes) has none.
const get = asyncHandler(async (req, res) => {
  const scope = req.query.scope === "identity" || req.query.scope === "tenant" ? req.query.scope : null;
  const primaryDb = scope === "identity" ? req.identityDb : req.tenantDb;
  const secondaryDb = scope === "identity" ? req.tenantDb : req.identityDb;

  let row = await primaryDb((c) => service.get(c, req.params.id));
  if (!row) row = await secondaryDb((c) => service.get(c, req.params.id));
  if (!row) throw new AppError("NOT_FOUND", "Audit entry not found", 404);

  // Best-effort UUID -> human label for the Entity row (e.g.
  // "corporate_entity:fc3f680f-…" -> "SLAS Cameroun"). See entity-label.js
  // for which types resolve today; unmapped types come back null and the
  // client falls back to the raw entity_ref, same as before this existed.
  const entity_label = await resolveEntityLabel(req, row.entity_ref);
  res.json({ data: { ...row, entity_label } });
});

const listSoftDeletes = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.listSoftDeletes(client, req.query)) });
});

const requestRestore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.requestRestore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

const restore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.restore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

// Access reviews (4.1) — governance over identity access: snapshotEntries reads
// app_user/user_role (identity) and the review references user_ids. Pinned to the
// identity (live) schema so a review always covers the real (live) access, and
// works identically under LIVE and TEST. See middleware/tenant-context.js.
const listReviews = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listReviews(c, req.query)) }));
const createReview = asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.createReview(c, { name: req.body.name, actor: req.user })) }));
const getReview = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getReview(c, req.params.id)) }));
const completeReview = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.completeReview(c, { id: req.params.id, actor: req.user })) }));
const decideEntry = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.decideEntry(c, { reviewId: req.params.id, entryId: req.params.entryId, decision: req.body.decision, note: req.body.note, actor: req.user })) }));

// Security-events read (4.2) — auth + RBAC now emit their event_log rows via the
// live client (identity is env-independent), so security-critical events live in
// the live schema. Read them from there, else TEST shows an empty security log.
const listSecurityEvents = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listSecurityEvents(c, req.query)) }));

// GET /audit/my-feed — the Control Tower's "Recent activity" data source.
// Ungated at the router; hard-scoped here to actor_user_id = req.user.user_id
// so a caller can only ever see their OWN actions. See the routes file for the
// non-negotiable "no requirePermission" note.
//
// Two schemas at play — identity events (auth/RBAC/permission) live in
// live.immutable_ledger; business writes (invoice, sales, wms, …) live in the
// tenant's <env> schema. Two separate queries rather than a UNION at SQL: the
// registry lease switches search_path per call, so keeping the queries apart
// keeps per-schema pool boundaries clean and lets each side degrade
// independently (a broken schema on one side is not a 500 on the other,
// though we don't try/catch here today).
//
// The response envelope is `{ data, meta }`. The client's apiPaged
// (client/src/lib/api-client.ts:202-227) unwraps `{ data }` to a bare array
// UNLESS a sibling `meta` key is present — flat `{ data, page, total }`
// would collapse the list. Meta stays as its own object.
const myFeed = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
  const pageSize = 10;
  // 3 pages × 10 rows. Anything beyond that is the full Audit Terminal's
  // job (Governance → Ledger); the Control Tower widget is a glance.
  const maxTotal = 30;

  const [idRows, tnRows] = await Promise.all([
    req.identityDb((c) => service.myFeed(c, req.user.user_id, maxTotal)),
    req.tenantDb((c) => service.myFeed(c, req.user.user_id, maxTotal)),
  ]);

  // Tag each row with which ledger it came from. `get` (above) needs this to
  // query the right schema on the first try — ledger_id is a per-schema
  // serial, so a bare id doesn't say which of the two tables it's from.
  const tag = (rows, ledger_scope) => rows.map((r) => ({ ...r, ledger_scope }));

  const merged = [...tag(idRows, "identity"), ...tag(tnRows, "tenant")]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, maxTotal);

  const offset = (page - 1) * pageSize;
  const slice = merged.slice(offset, offset + pageSize);
  const newest = slice[0]?.created_at ? new Date(slice[0].created_at) : null;
  // "Last 24 hours" reads honest on page 1 when the newest row is recent;
  // deeper pages just say "Latest actions" so the header never lies.
  const window = page === 1 && newest && (Date.now() - newest.getTime()) < 24 * 3600e3
    ? "24h"
    : "all_time";

  res.json({
    data: slice,
    meta: {
      window,
      page,
      page_size: pageSize,
      total: merged.length,
      has_more: offset + slice.length < merged.length,
    },
  });
});

module.exports = {
  ...crud, listSoftDeletes, requestRestore, restore,
  listReviews, createReview, getReview, completeReview, decideEntry,
  listSecurityEvents,
  myFeed,
  // Must follow `...crud` — overrides crud.get with the scope-aware version
  // above. `list` is intentionally left as crud.list, unchanged.
  get,
};
