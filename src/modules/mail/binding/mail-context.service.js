/**
 * Smart Dossier aggregator. MUST NOT call party-360.service.js.
 * Overview is one round-trip set (≤ 6 statements). Tabs are lazy.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

function parseRef(entityRef) {
  const m = String(entityRef || "").match(/^([a-z_]+):([A-Za-z0-9-]+)$/);
  if (!m) throw new AppError("VALIDATION_ERROR", "entity_ref is required", 422);
  return { kind: m[1], id: m[2] };
}

async function overview(client, entityRef) {
  const { kind, id } = parseRef(entityRef);
  if (kind === "client") return clientOverview(client, id);
  if (kind === "dossier") return dossierOverview(client, id);
  if (kind === "supplier") return supplierOverview(client, id);
  return { kind: kind.toUpperCase(), header: { ref: id }, overview: {}, tabs_available: [] };
}

async function clientOverview(client, id) {
  const { rows } = await client.query(
    `SELECT client_id, name, ref, is_vip, preferred_language, payment_terms_days, credit_limit,
            cached_receivables AS outstanding_xaf, cached_overdue AS overdue_xaf
       FROM client_master WHERE client_id = $1`,
    [id],
  );
  const c = rows[0];
  if (!c) throw new AppError("NOT_FOUND", "client not found", 404);
  const extra = await client.query(
    `SELECT
       (SELECT count(*) FROM dossier_visible WHERE client_id = $1 AND status NOT IN ('CLOSED','CANCELLED')) AS open_dossiers,
       (SELECT count(*) FROM quotation WHERE client_id = $1 AND status NOT IN ('ACCEPTED','REJECTED','EXPIRED')) AS open_quotes`,
    [id],
  ).then((r) => r.rows[0] || {}).catch(() => ({}));
  return {
    kind: "CLIENT",
    header: { name: c.name, ref: c.ref, is_vip: c.is_vip, language: c.preferred_language },
    overview: {
      outstanding_xaf: c.outstanding_xaf, overdue_xaf: c.overdue_xaf,
      credit_limit: c.credit_limit,
      credit_headroom: c.credit_limit !== null && c.credit_limit !== undefined
        ? Number(c.credit_limit) - Number(c.outstanding_xaf || 0)
        : null,
      payment_terms_days: c.payment_terms_days,
      open_dossiers: Number(extra.open_dossiers || 0),
      open_quotes: Number(extra.open_quotes || 0),
      documents_missing: null,
      last_contact_at: null,
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
  if (!d) throw new AppError("NOT_FOUND", "dossier not found", 404);
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
    tabs_available: ["money", "operations"],
  };
}

async function tab(client, entityRef, tabName) {
  const { kind, id } = parseRef(entityRef);
  if (tabName === "money" && kind === "client") {
    const { rows } = await client.query(
      `SELECT invoice_id, doc_number, due_on, total_ttc, status
         FROM invoice WHERE client_id = $1 AND status NOT IN ('PAID','VOID')
         ORDER BY due_on NULLS LAST LIMIT 50`,
      [id],
    ).catch(() => ({ rows: [] }));
    return { tab: "money", invoices: rows };
  }
  return { tab: tabName, kind, id, rows: [] };
}

module.exports = { overview, tab, parseRef };
