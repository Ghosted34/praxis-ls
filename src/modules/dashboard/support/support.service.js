"use strict";
/**
 * Tenant-side Support & Feedback (PRD §11.2). Tickets are a tenant→Praxis
 * channel, so they live in the CENTRAL platform DB (platform.support_ticket),
 * keyed by tenant_id — the Platform Console triages them across all tenants
 * without any cross-tenant fan-out. This module only ever reads/writes rows for
 * the caller's own tenant_id (scoped by every query below).
 */
const platformDb = require("../../../services/platform/db");

async function create(tenantId, email, { kind, title, body, context }) {
  const { rows } = await platformDb.query(
    "INSERT INTO platform.support_ticket (tenant_id, raised_by_email, kind, title, body, context) " +
      "VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [tenantId, email || null, kind, title, body || "", context || {}],
  );
  return rows[0];
}

async function list(tenantId, { status } = {}) {
  const params = [tenantId];
  let sql = "SELECT * FROM platform.support_ticket WHERE tenant_id=$1";
  if (status) {
    params.push(status);
    sql += " AND status=$2";
  }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const { rows } = await platformDb.query(sql, params);
  return rows;
}

async function get(tenantId, ticketId) {
  const { rows } = await platformDb.query(
    "SELECT * FROM platform.support_ticket WHERE tenant_id=$1 AND ticket_id=$2",
    [tenantId, ticketId],
  );
  if (!rows[0]) {
    const e = new Error("ticket not found");
    e.status = 404;
    throw e;
  }
  return rows[0];
}

/** CSAT is only meaningful once Praxis has resolved the ticket. */
async function submitCsat(tenantId, ticketId, csat) {
  await get(tenantId, ticketId); // 404s if not this tenant's
  const { rows } = await platformDb.query(
    "UPDATE platform.support_ticket SET csat=$3 WHERE tenant_id=$1 AND ticket_id=$2 " +
      "AND status IN ('SHIPPED','DECLINED') RETURNING *",
    [tenantId, ticketId, csat],
  );
  if (!rows[0]) {
    const e = new Error("CSAT can only be submitted on a resolved ticket");
    e.status = 422;
    throw e;
  }
  return rows[0];
}

module.exports = { create, list, get, submitCsat };
