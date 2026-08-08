/**
 * The 360° command-centre aggregation (spec §7, §8.2). One call returns a party's
 * master record, GL-derived KPIs, aging, its child collections (contacts,
 * addresses, banks, documents, registrations, beneficial owners), live compliance
 * and the GL-integrity parity. Built to render for a BRAND-NEW party with zero
 * data — every figure defaults to 0 and every collection to [] (acceptance gate 4).
 *
 * Compliance and GL parity are recomputed here, which is the spec's "on-demand,
 * called from 360" model (§4.2). GL is the source of truth for the money figures
 * (Hard Rule 4). Bank numbers are masked unless the caller has finance visibility
 * (gate 14).
 */
"use strict";
const clientRepo = require("./client_master/client_master.repo");
const compliance = require("./compliance/compliance.service");
const dedup = require("./_shared/dedup.service");
const changeRequest = require("./_shared/change-request.service");
const supplierScorecard = require("./supplier_scorecard.service");
const { maskBank } = require("./_shared/confidential");
const { AppError } = require("../../utils/errors");

const INVOICE_LOCKED = ["ISSUED_LOCKED", "APPROVED_LOCKED", "POSTED_LOCKED"];
const SUPPLIER_POSTED = ["POSTED_LOCKED", "PAID"];
const MS_DAY = 24 * 60 * 60 * 1000;
const AGING_BUCKET_KEYS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

async function one(c, sql, params) {
  const { rows } = await c.query(sql, params);
  return rows[0] || {};
}

/** Whole days from `dueOn` to `asOf` — positive once a due date is in the past,
 *  null with no due date. A small local copy of smart_receivables' daysOverdue;
 *  duplicated rather than imported so master does not reach across into finance. */
function daysPastDue(dueOn, asOf) {
  if (!dueOn) return null;
  const a = new Date(dueOn).getTime();
  const b = new Date(asOf).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / MS_DAY);
}

/** Same bucket edges as the client aging SQL below, expressed on a day-count so
 *  the invoice-level drill-down (`agingDetail`) and the supplier bucket sums
 *  classify identically to it. */
function bucketOf(daysOver) {
  if (daysOver === null || daysOver <= 0) return "current";
  if (daysOver <= 30) return "d1_30";
  if (daysOver <= 60) return "d31_60";
  if (daysOver <= 90) return "d61_90";
  return "d90_plus";
}

/** Open (outstanding > 0) FINAL invoices for a client — the same population the
 *  aging SQL in `clientKpis` sums, but row-level for the drill-down modal. */
async function clientOpenInvoices(c, partyId) {
  const { rows } = await c.query(
    `WITH finals AS (
       SELECT invoice_id, doc_number, total_ttc, payment_due_on FROM invoice
        WHERE client_id = $1 AND type = 'FINAL' AND status = ANY($2)
     ),
     paid AS (
       SELECT invoice_id, SUM(amount) amt FROM payment_allocation
        WHERE invoice_id IN (SELECT invoice_id FROM finals) GROUP BY invoice_id
     )
     SELECT f.invoice_id AS id, f.doc_number, f.payment_due_on AS due_on,
            GREATEST(f.total_ttc - COALESCE(p.amt, 0), 0) AS amount
       FROM finals f LEFT JOIN paid p ON p.invoice_id = f.invoice_id
      WHERE GREATEST(f.total_ttc - COALESCE(p.amt, 0), 0) > 0`,
    [partyId, INVOICE_LOCKED],
  );
  return rows;
}

/** Open (POSTED_LOCKED, not yet PAID) bills for a supplier. There is no
 *  partial-payment/allocation table on the AP side — a supplier invoice settles
 *  whole — so its full amount_ttc is the outstanding balance. */
async function supplierOpenInvoices(c, partyId) {
  const { rows } = await c.query(
    `SELECT supplier_invoice_id AS id, doc_number, due_on, amount_ttc AS amount
       FROM supplier_invoice WHERE supplier_id = $1 AND status = 'POSTED_LOCKED'`,
    [partyId],
  );
  return rows;
}

/** Bucket + day-count every open row as of one date. */
function annotateAging(rows, asOf) {
  return rows.map((r) => {
    const daysOver = daysPastDue(r.due_on, asOf);
    return {
      id: r.id,
      doc_number: r.doc_number || null,
      due_on: r.due_on || null,
      amount: Number(r.amount) || 0,
      bucket: bucketOf(daysOver),
      days_overdue: daysOver !== null && daysOver > 0 ? daysOver : 0,
      days_until_due: daysOver !== null && daysOver < 0 ? -daysOver : null,
    };
  });
}

/** Aging bucket sums for the party 360 Aging card — client receivables or
 *  supplier payables, same shape either side. */
async function agingSums(c, kind, partyId, asOf) {
  const rows = kind === "client" ? await clientOpenInvoices(c, partyId) : await supplierOpenInvoices(c, partyId);
  const items = annotateAging(rows, asOf);
  const sums = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const i of items) sums[i.bucket] = Math.round((sums[i.bucket] + i.amount) * 100) / 100;
  return sums;
}

/**
 * Invoice-level aging drill-down (party 360 Aging cards, both masters) —
 * GET /clients/:id/aging and /suppliers/:id/aging, `bucket` required. Reads the
 * SAME open-invoice population `agingSums` totals, so a card's figure and its
 * modal's line items always foot to the same number.
 */
async function agingDetail(c, { kind, partyId, bucket, asOf }) {
  if (!AGING_BUCKET_KEYS.includes(bucket)) {
    throw new AppError("VALIDATION_ERROR", `bucket must be one of ${AGING_BUCKET_KEYS.join(", ")}`, 422, { bucket: ["invalid"] });
  }
  const at = asOf || new Date().toISOString().slice(0, 10);
  const rows = kind === "client" ? await clientOpenInvoices(c, partyId) : await supplierOpenInvoices(c, partyId);
  const invoices = annotateAging(rows, at)
    .filter((i) => i.bucket === bucket)
    .sort((a, b) => b.days_overdue - a.days_overdue || String(a.due_on || "").localeCompare(String(b.due_on || "")));
  const totalMinor = invoices.reduce((s, i) => s + Math.round(i.amount * 100), 0);
  return { as_of: at, bucket, count: invoices.length, total: Math.round(totalMinor) / 100, invoices };
}

/** Load the six child collections shared by both masters. */
async function collections(c, kind, partyId, canSeeFinancials) {
  const pk = `${kind}_id`;
  const [contacts, addresses, banks, documents, registrations, owners] = [
    await c.query(`SELECT * FROM ${kind}_contact WHERE ${pk} = $1 ORDER BY is_primary DESC, created_at`, [partyId]),
    await c.query(`SELECT * FROM ${kind}_address WHERE ${pk} = $1 ORDER BY is_primary DESC, created_at`, [partyId]),
    await c.query(`SELECT * FROM ${kind}_bank_account WHERE ${pk} = $1 ORDER BY is_primary DESC, created_at`, [partyId]),
    await c.query(
      `SELECT d.*, t.name AS document_type_name, t.default_severity
         FROM ${kind}_document d LEFT JOIN party_document_type t ON t.document_type_id = d.document_type_id
        WHERE d.${pk} = $1 ORDER BY d.expires_on NULLS LAST`,
      [partyId],
    ),
    await c.query(`SELECT * FROM party_registration WHERE ${pk} = $1 ORDER BY created_at`, [partyId]),
    await c.query(`SELECT * FROM ${kind}_beneficial_owner WHERE ${pk} = $1 ORDER BY ownership_percent DESC NULLS LAST`, [partyId]),
  ];
  return {
    contacts: contacts.rows,
    addresses: addresses.rows,
    banks: banks.rows.map((b) => maskBank(b, canSeeFinancials)),
    documents: documents.rows,
    registrations: registrations.rows,
    beneficial_owners: owners.rows,
  };
}

/** Likely duplicates of THIS party (score ≥ 80) for the 360's amber banner. The
 *  record itself is excluded so it never flags as its own duplicate. */
async function duplicatesFor(c, kind, party, registrations) {
  const input = {
    name: party.name, legal_name: party.legal_name, email: party.email,
    registrations: (registrations || []).map((r) => ({ kind: r.kind, number: r.number })),
  };
  const { candidates } = await dedup.findDuplicates(c, { kind, input, excludeId: party[`${kind}_id`], min: 80 });
  return candidates;
}

/** The trading names this party was known by (from merges / former names). */
async function aliasesFor(c, kind, partyId) {
  const { rows } = await c.query(
    "SELECT alias, kind, created_at FROM party_alias WHERE party_kind = $1 AND party_id = $2 ORDER BY created_at DESC",
    [kind, partyId],
  );
  return rows;
}

async function clientKpis(c, partyId, party) {
  const { outstanding, overdue } = await clientRepo.outstandingFor(c, partyId);
  const aging = await one(
    c,
    `WITH finals AS (
       SELECT invoice_id, total_ttc, payment_due_on FROM invoice
        WHERE client_id = $1 AND type = 'FINAL' AND status = ANY($2)
     ),
     paid AS (
       SELECT invoice_id, SUM(amount) amt FROM payment_allocation
        WHERE invoice_id IN (SELECT invoice_id FROM finals) GROUP BY invoice_id
     ),
     rem AS (
       SELECT f.payment_due_on, GREATEST(f.total_ttc - COALESCE(p.amt, 0), 0) AS due
         FROM finals f LEFT JOIN paid p ON p.invoice_id = f.invoice_id
     )
     SELECT
       COALESCE(SUM(due) FILTER (WHERE payment_due_on IS NULL OR payment_due_on >= CURRENT_DATE), 0) AS current,
       COALESCE(SUM(due) FILTER (WHERE payment_due_on <  CURRENT_DATE AND payment_due_on >= CURRENT_DATE - 30), 0) AS d1_30,
       COALESCE(SUM(due) FILTER (WHERE payment_due_on <  CURRENT_DATE - 30 AND payment_due_on >= CURRENT_DATE - 60), 0) AS d31_60,
       COALESCE(SUM(due) FILTER (WHERE payment_due_on <  CURRENT_DATE - 60 AND payment_due_on >= CURRENT_DATE - 90), 0) AS d61_90,
       COALESCE(SUM(due) FILTER (WHERE payment_due_on <  CURRENT_DATE - 90), 0) AS d90_plus,
       MIN(payment_due_on) FILTER (WHERE due > 0 AND payment_due_on < CURRENT_DATE) AS oldest_due
     FROM rem`,
    [partyId, INVOICE_LOCKED],
  );
  const ytd = await one(
    c,
    `SELECT COALESCE(SUM(total_ttc), 0) AS v FROM invoice
      WHERE client_id = $1 AND type = 'FINAL' AND status = ANY($2)
        AND date_part('year', created_at) = date_part('year', CURRENT_DATE)`,
    [partyId, INVOICE_LOCKED],
  );
  const wip = await one(c, "SELECT COUNT(*) AS n FROM dossier WHERE client_id = $1 AND status NOT IN ('CLOSED', 'CANCELLED', 'ARCHIVED')", [partyId]);
  const limit = party.credit_limit === null || party.credit_limit === undefined ? null : Number(party.credit_limit);
  return {
    outstanding, overdue,
    oldest_due_date: aging.oldest_due || null,
    credit_limit: limit,
    credit_available: limit === null ? null : Math.round((limit - outstanding) * 100) / 100,
    ytd_revenue: Number(ytd.v) || 0,
    dossiers_in_progress: Number(wip.n) || 0,
    aging: {
      current: Number(aging.current) || 0, d1_30: Number(aging.d1_30) || 0, d31_60: Number(aging.d31_60) || 0,
      d61_90: Number(aging.d61_90) || 0, d90_plus: Number(aging.d90_plus) || 0,
    },
  };
}

async function supplierKpis(c, partyId) {
  const payable = await one(
    c,
    `SELECT
       COALESCE(SUM(amount_ttc) FILTER (WHERE status = 'POSTED_LOCKED'), 0) AS payables,
       COALESCE(SUM(amount_ttc) FILTER (WHERE status = 'POSTED_LOCKED' AND due_on < CURRENT_DATE), 0) AS overdue,
       MIN(due_on) FILTER (WHERE status = 'POSTED_LOCKED' AND due_on < CURRENT_DATE) AS oldest_due
     FROM supplier_invoice WHERE supplier_id = $1`,
    [partyId],
  );
  const ytd = await one(
    c,
    `SELECT COALESCE(SUM(amount_ttc), 0) AS v FROM supplier_invoice
      WHERE supplier_id = $1 AND status = ANY($2)
        AND date_part('year', created_at) = date_part('year', CURRENT_DATE)`,
    [partyId, SUPPLIER_POSTED],
  );
  const pos = await one(c, "SELECT COUNT(*) AS n FROM purchase_order WHERE supplier_id = $1 AND status NOT IN ('CLOSED', 'CANCELLED')", [partyId]);
  const aging = await agingSums(c, "supplier", partyId, new Date().toISOString().slice(0, 10));
  return {
    payables: Number(payable.payables) || 0,
    overdue_payables: Number(payable.overdue) || 0,
    oldest_due_date: payable.oldest_due || null,
    ytd_spend: Number(ytd.v) || 0,
    open_purchase_orders: Number(pos.n) || 0,
    aging,
  };
}

/** GET /clients/:id/360 */
async function clientDossier(c, { partyId, canSeeFinancials = false }) {
  const party = await one(
    c,
    "SELECT cm.*, ct.name AS category_name FROM client_master cm LEFT JOIN client_type ct ON ct.client_type_id = cm.client_type_id WHERE cm.client_id = $1",
    [partyId],
  );
  if (!party.client_id) throw new AppError("NOT_FOUND", "Client not found", 404);

  const [kpis, coll, comp, parity] = [
    await clientKpis(c, partyId, party),
    await collections(c, "client", partyId, canSeeFinancials),
    await compliance.sync(c, { kind: "client", partyId }),
    await compliance.glParity(c, { kind: "client", partyId }),
  ];
  const dossiers = (await c.query("SELECT dossier_id, ref, title, status, created_at FROM dossier WHERE client_id = $1 ORDER BY created_at DESC LIMIT 25", [partyId])).rows;
  const invoices = (await c.query("SELECT invoice_id, doc_number, type, total_ttc, status, payment_due_on, created_at FROM invoice WHERE client_id = $1 ORDER BY created_at DESC LIMIT 25", [partyId])).rows;
  const receipts = (await c.query("SELECT receipt_id, amount, method, received_on, status FROM payment_receipt WHERE client_id = $1 ORDER BY received_on DESC LIMIT 25", [partyId])).rows;
  const advances = (await c.query("SELECT advance_id, amount, applied_amount, received_on FROM advance WHERE client_id = $1 ORDER BY received_on DESC LIMIT 25", [partyId])).rows;

  // 360 richness (§3): the record's aliases, its likely duplicates, and any
  // pending sensitive-field / merge change requests awaiting a second approver.
  const [aliases, duplicate_candidates, pending_changes] = [
    await aliasesFor(c, "client", partyId),
    await duplicatesFor(c, "client", party, coll.registrations),
    await changeRequest.pendingFor(c, { kind: "client", partyId }),
  ];

  return { party, kpis, compliance: comp, gl_parity: parity, ...coll, dossiers, invoices, receipts, advances, aliases, duplicate_candidates, pending_changes };
}

/** GET /suppliers/:id/360 */
async function supplierDossier(c, { partyId, canSeeFinancials = false }) {
  const party = await one(
    c,
    "SELECT sm.*, st.name AS category_name FROM supplier_master sm LEFT JOIN supplier_type st ON st.supplier_type_id = sm.supplier_type_id WHERE sm.supplier_id = $1",
    [partyId],
  );
  if (!party.supplier_id) throw new AppError("NOT_FOUND", "Supplier not found", 404);

  const [kpis, coll, comp, parity] = [
    await supplierKpis(c, partyId),
    await collections(c, "supplier", partyId, canSeeFinancials),
    await compliance.sync(c, { kind: "supplier", partyId }),
    await compliance.glParity(c, { kind: "supplier", partyId }),
  ];
  const purchase_orders = (await c.query("SELECT po_id, doc_number, total_ttc, status, created_at FROM purchase_order WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 25", [partyId])).rows;
  const supplier_invoices = (await c.query("SELECT supplier_invoice_id, doc_number, amount_ttc, wht_total, status, due_on, created_at FROM supplier_invoice WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 25", [partyId])).rows;

  // 360 richness (§3): AVL scorecard (computed on load), aliases, likely
  // duplicates, and any pending change requests.
  const [scorecard, aliases, duplicate_candidates, pending_changes] = [
    await supplierScorecard.evaluate(c, { supplierId: partyId }),
    await aliasesFor(c, "supplier", partyId),
    await duplicatesFor(c, "supplier", party, coll.registrations),
    await changeRequest.pendingFor(c, { kind: "supplier", partyId }),
  ];

  return { party, kpis, compliance: comp, gl_parity: parity, ...coll, purchase_orders, supplier_invoices, scorecard, aliases, duplicate_candidates, pending_changes };
}

module.exports = { clientDossier, supplierDossier, agingDetail };
