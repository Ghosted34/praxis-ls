"use strict";
/**
 * Platform-side Support & Feedback triage (PRD §11.2). Reads/curates
 * platform.support_ticket across ALL tenants (joined to platform.tenant for
 * human names) and drives the NEW→TRIAGED→IN_PROGRESS→SHIPPED/DECLINED
 * lifecycle. Every status change lands in platform.platform_audit.
 */
const platformDb = require("./db");

const STATUSES = ["NEW", "TRIAGED", "IN_PROGRESS", "SHIPPED", "DECLINED"];

async function audit(actorId, tenantId, action, entityRef, payload) {
  await platformDb.query(
    "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,$2,$3,$4,$5)",
    [actorId, tenantId, action, entityRef, payload || {}],
  );
}

const SELECT =
  "SELECT st.*, t.slug AS tenant_slug, t.display_name AS tenant_name " +
  "FROM platform.support_ticket st JOIN platform.tenant t ON t.tenant_id = st.tenant_id ";

async function list({ status, kind, tenant, limit } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`st.status = $${params.length}`); }
  if (kind) { params.push(kind); where.push(`st.kind = $${params.length}`); }
  if (tenant) { params.push(tenant); where.push(`t.slug = $${params.length}`); }
  const lim = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
  const sql = SELECT + (where.length ? "WHERE " + where.join(" AND ") + " " : "") +
    "ORDER BY st.created_at DESC LIMIT " + lim;
  const { rows } = await platformDb.query(sql, params);
  return rows;
}

async function get(id) {
  const { rows } = await platformDb.query(SELECT + "WHERE st.ticket_id = $1", [id]);
  if (!rows[0]) { const e = new Error("ticket not found"); e.status = 404; throw e; }
  return rows[0];
}

async function setStatus(id, status, actorId) {
  if (!STATUSES.includes(status)) { const e = new Error("invalid status"); e.status = 422; throw e; }
  const { rows } = await platformDb.query(
    "UPDATE platform.support_ticket SET status = $2 WHERE ticket_id = $1 RETURNING *",
    [id, status],
  );
  if (!rows[0]) { const e = new Error("ticket not found"); e.status = 404; throw e; }
  await audit(actorId, rows[0].tenant_id, "support.status_changed", id, { status });
  return rows[0];
}

module.exports = { list, get, setStatus, STATUSES };
