/**
 * Smart Dossier aggregator (§7.5).
 *
 * MUST NOT call `party-360.service.js`. That service computes aging detail,
 * compliance recomputation, GL parity and child collections — correct for a 360
 * page, far too much for a drawer that opens on every thread click.
 *
 * ── THE BUDGET IS PART OF THE CONTRACT ──────────────────────────────────────
 *
 * §3.6: ≤ 6 SQL statements, 300 ms cold, **50 ms warm**. The warm figure is not
 * reachable by writing faster SQL; it is reachable by not running any, which is
 * why `context-cache.js` exists and why it is used here rather than left as a
 * later optimisation. `tests/integration/mail-context-budget.test.js` counts
 * the statements on a real call and fails the build past six.
 *
 * ── EVERY ENTRY POINT TAKES THE CALLER ──────────────────────────────────────
 *
 * `opts.userId` is threaded through and used for anything derived from
 * correspondence. The route always passed it; the service used to drop it on
 * the floor, which meant the drawer could show a colleague's Private thread as
 * "last contact" — the §9.5 predicate defeated one layer above where it is
 * enforced. Reads that do not touch mail (a client's credit limit) do not need
 * it; reads that do, do.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const cache = require("./context-cache");
const visibility = require("../triage/visibility");
const { tabQuery } = require("./context-tabs");
const identityCache = require("../../../shared/cache/identity-cache");

/**
 * P3-1. The drawer used to show client financials (outstanding, overdue,
 * credit limit, headroom) to any MOD-72 view user. The AI grounding layer
 * re-checks per-source module RBAC; the drawer did not. Receivables (MOD-56)
 * is the owning module for those numbers — same key the AI whitelist uses
 * for payment status.
 *
 * Fail closed: a missing user, a missing grant, or a grant lookup that
 * throws all withhold the numbers. `getGrants` with an empty role set
 * returns [] without querying, so the overview budget does not grow for
 * callers that have not passed a principal.
 */
async function maySeeFinancials(client, user) {
  if (!user) return false;
  if (user.is_ceo === true) return true;
  try {
    const grants = await identityCache.getGrants(client, {
      role_ids: user.role_ids || [],
      module: "MOD-56",
    });
    return grants.some((g) => g.can_read === true);
  } catch {
    return false;
  }
}

function parseRef(entityRef) {
  const m = String(entityRef || "").match(/^([a-z_]+):([A-Za-z0-9-]+)$/);
  if (!m) throw new AppError("VALIDATION_ERROR", "entity_ref is required", 422);
  return { kind: m[1], id: m[2] };
}

// The dossier drawer is reached from Mail, but it exposes records owned by
// other modules. Mail permission is the right to open correspondence, not a
// blanket read grant over every client, supplier or operations file in the
// tenant. Keep this mapping beside the aggregator so direct service callers
// cannot bypass the HTTP route's intent.
const ENTITY_MODULE = Object.freeze({ client: "MOD-03", supplier: "MOD-04", dossier: "MOD-29" });

async function assertEntityAccess(client, kind, user) {
  if (user && user.is_ceo === true) return;
  const moduleKey = ENTITY_MODULE[kind];
  if (!moduleKey || !user) throw new AppError("NOT_FOUND", "context not found", 404);
  const grants = await identityCache.getGrants(client, {
    role_ids: user.role_ids || [], module: moduleKey,
  });
  if (!grants.some((g) => g.can_read === true)) {
    // Same opaque refusal as the mail visibility predicate: an operator who
    // cannot read a dossier should not learn that it exists from its UUID.
    throw new AppError("NOT_FOUND", "context not found", 404);
  }
}

async function overview(client, entityRef, opts = {}) {
  const { kind, id } = parseRef(entityRef);
  const userId = opts.userId || null;

  const hit = await cache.get(entityRef, "overview", userId);
  if (hit) return { ...hit, cached: true };

  let data;
  if (kind === "client") data = await clientOverview(client, id, userId, opts.user || null);
  else if (kind === "dossier") data = await dossierOverview(client, id);
  else if (kind === "supplier") data = await supplierOverview(client, id);
  else data = { kind: kind.toUpperCase(), header: { ref: id }, overview: {}, tabs_available: [] };

  await cache.set(entityRef, "overview", userId, data);
  return { ...data, cached: false };
}

async function clientOverview(client, id, userId = null, user = null) {
  const { rows } = await client.query(
    `SELECT client_id, name, ref, is_vip, preferred_language, payment_terms_days, credit_limit,
            cached_receivables AS outstanding_xaf, cached_overdue AS overdue_xaf
       FROM client_master WHERE client_id = $1`,
    [id],
  );
  const c = rows[0];
  if (!c) throw new AppError("NOT_FOUND", "client not found", 404);
  // THREE counts in ONE statement, deliberately. Six statements is the whole
  // budget for the drawer (§3.6), and each of these is a scalar subquery the
  // planner runs independently anyway — splitting them buys nothing and spends
  // two thirds of the allowance on the Overview tab alone.
  const extra = await client.query(
    `SELECT
       (SELECT count(*) FROM dossier_visible WHERE client_id = $1 AND status NOT IN ('CLOSED','CANCELLED')) AS open_dossiers,
       (SELECT count(*) FROM quotation WHERE client_id = $1 AND status NOT IN ('ACCEPTED','REJECTED','EXPIRED')) AS open_quotes,
       (SELECT count(*) FROM document_requirement r
         WHERE r.is_active AND r.applies_to = 'CLIENT' AND r.is_mandatory
           AND NOT EXISTS (SELECT 1 FROM document_vault v
                             JOIN dictionary_ref d ON d.ref_id = v.doc_type_ref_id
                            WHERE v.client_id = $1
                              AND d.kind = 'DOCUMENT_TYPE'
                              AND d.code = r.doc_type_code)) AS documents_missing`,
    [id],
  ).then((r) => r.rows[0] || {}).catch(() => ({}));

  // `last_contact_at` is derived from CORRESPONDENCE, so it carries the same
  // per-thread visibility predicate as the mailbox itself (§9.5 names the
  // client timeline explicitly). Without the caller it cannot be computed, and
  // null is the honest answer rather than the newest thread in the tenant.
  const contact = userId
    ? await client.query(
      `SELECT max(m.received_at) AS last_contact_at
         FROM email_message m
         JOIN email_thread t ON t.email_thread_id = m.email_thread_id
         JOIN email_connection c ON c.email_connection_id = t.email_connection_id
        WHERE t.entity_ref = $2 AND ${visibility.clause("$1")}`,
      [userId, `client:${id}`],
    ).then((r) => r.rows[0] || {}).catch(() => ({}))
    : {};

  const money = await maySeeFinancials(client, user);
  return {
    kind: "CLIENT",
    header: { name: c.name, ref: c.ref, is_vip: c.is_vip, language: c.preferred_language },
    overview: {
      outstanding_xaf: money ? c.outstanding_xaf : null,
      overdue_xaf: money ? c.overdue_xaf : null,
      credit_limit: money ? c.credit_limit : null,
      credit_headroom: money && c.credit_limit !== null && c.credit_limit !== undefined
        ? Number(c.credit_limit) - Number(c.outstanding_xaf || 0)
        : null,
      financials_withheld: !money,
      payment_terms_days: c.payment_terms_days,
      open_dossiers: Number(extra.open_dossiers || 0),
      open_quotes: Number(extra.open_quotes || 0),
      documents_missing: extra.documents_missing === undefined ? null : Number(extra.documents_missing),
      last_contact_at: contact.last_contact_at || null,
    },
    tabs_available: ["money", "operations", "commercial", "documents", "interactions", "compliance"],
  };
}

async function dossierOverview(client, id) {
  const { rows } = await client.query(
    `SELECT dossier_id, ref, status, client_id FROM dossier_visible WHERE dossier_id = $1`,
    [id],
  );
  const d = rows[0];
  if (!d) throw new AppError("NOT_FOUND", "operations file not found", 404);
  return {
    kind: "DOSSIER",
    header: { name: d.ref, ref: d.ref, status: d.status },
    overview: { client_id: d.client_id },
    tabs_available: ["operations", "documents", "money"],
  };
}

async function supplierOverview(client, id) {
  const { rows } = await client.query(
    `SELECT supplier_id, name, ref FROM supplier_master WHERE supplier_id = $1`,
    [id],
  );
  const s = rows[0];
  if (!s) throw new AppError("NOT_FOUND", "supplier not found", 404);
  return {
    kind: "SUPPLIER",
    header: { name: s.name, ref: s.ref },
    overview: {},
    // Only the tabs actually implemented for a supplier. Advertising one that
    // answers `not_built` puts the honesty in the wrong place — the drawer
    // should not offer a tab it cannot fill.
    tabs_available: ["money", "interactions", "compliance"],
  };
}

async function tab(client, entityRef, tabName, opts = {}) {
  const { kind, id } = parseRef(entityRef);
  const userId = opts.userId || null;
  const hit = await cache.get(entityRef, tabName, userId);
  if (hit) return { ...hit, cached: true };
  const data = await tabQuery(client, kind, id, tabName, userId, opts.user || null);
  await cache.set(entityRef, tabName, userId, data);
  return { ...data, cached: false };
}

module.exports = { overview, tab, tabQuery, parseRef, maySeeFinancials, assertEntityAccess, invalidate: cache.invalidate };
