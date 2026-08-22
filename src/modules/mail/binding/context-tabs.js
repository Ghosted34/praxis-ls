/**
 * The dossier drawer's lazy tabs (§7.5).
 *
 * Five of the six were `{ rows: [] }`. Each is ONE query, on purpose: §7.5 makes
 * lazy tabs a design decision rather than an optimisation — "each tab is a
 * separate lazy call, so the drawer paints instantly and only the tab you open
 * costs anything. That is what makes the 300 ms budget achievable."
 *
 * ── SUPPLIER THREADS FLIP THE PANE ──────────────────────────────────────────
 *
 * §7.5: a supplier gets open POs, three-way-match exceptions and the scorecard
 * where a client gets aging and invoices. Same tab names, different content —
 * which is why every tab here dispatches on `kind` rather than assuming a
 * client, and why the unimplemented combinations say `not_built` instead of
 * returning an empty list that reads as "this supplier has none".
 *
 * ── WHAT NONE OF THESE MAY DO ───────────────────────────────────────────────
 *
 * Call `party-360.service.js` (§3.6 MUST NOT), or issue more than one statement.
 * The budget test counts, and a tab that grows a second query has spent a sixth
 * of the drawer's entire allowance on itself.
 */
"use strict";

const visibility = require("../triage/visibility");

/** Aging buckets, in one pass over the open invoices (§7.5 Money). */
const CLIENT_MONEY = `
  SELECT i.invoice_id, i.doc_number, i.payment_due_on AS due_on, i.total_ttc,
         i.currency, i.status,
         GREATEST(0, (CURRENT_DATE - i.payment_due_on))::int AS days_overdue,
         CASE
           WHEN i.payment_due_on IS NULL OR i.payment_due_on >= CURRENT_DATE THEN 'current'
           WHEN CURRENT_DATE - i.payment_due_on <= 30 THEN '1_30'
           WHEN CURRENT_DATE - i.payment_due_on <= 60 THEN '31_60'
           WHEN CURRENT_DATE - i.payment_due_on <= 90 THEN '61_90'
           ELSE '90_plus'
         END AS bucket
    FROM invoice i
   WHERE i.client_id = $1 AND i.status NOT IN ('PAID','VOID','CANCELLED')
   ORDER BY i.payment_due_on NULLS LAST
   LIMIT 100`;

/** Open POs plus what has been paid against them (§7.5 supplier flip). */
const SUPPLIER_MONEY = `
  SELECT p.po_id, p.doc_number, p.due_on, p.total_ttc, p.amount_paid, p.currency, p.status,
         (COALESCE(p.total_ttc,0) - COALESCE(p.amount_paid,0)) AS outstanding
    FROM purchase_order p
   WHERE p.supplier_id = $1 AND p.status NOT IN ('CLOSED','CANCELLED','PAID')
   ORDER BY p.due_on NULLS LAST
   LIMIT 100`;

/**
 * Open files with the milestone they are actually sitting on.
 *
 * The current stage is a lateral rather than a join, because a dossier has many
 * milestones and joining them multiplies the rows — the drawer wants one line
 * per file, not one per stage. `blocked` surfaces the thing the operator opened
 * the drawer to find out.
 */
const CLIENT_OPS = `
  SELECT d.dossier_id, d.ref, d.status, d.service_type_id, d.created_at,
         cur.code AS current_milestone, cur.label, cur.due_date,
         (cur.due_date IS NOT NULL AND cur.due_date < CURRENT_DATE) AS blocked
    FROM dossier_visible d
    LEFT JOIN LATERAL (
      SELECT m.code, m.label, m.due_date
        FROM milestone_instance m
       WHERE m.dossier_id = d.dossier_id AND m.status <> 'COMPLETED'
       ORDER BY m.stage_seq
       LIMIT 1
    ) cur ON true
   WHERE d.client_id = $1 AND d.status NOT IN ('CLOSED','CANCELLED')
   ORDER BY d.created_at DESC
   LIMIT 50`;

/** Open quotations, and what became of them (§7.5 Commercial). */
const CLIENT_COMMERCIAL = `
  SELECT q.quotation_id, q.doc_number, q.status, q.total_ttc, q.currency,
         q.valid_until, q.created_at,
         (q.valid_until IS NOT NULL AND q.valid_until < CURRENT_DATE) AS expired
    FROM quotation q
   WHERE q.client_id = $1
   ORDER BY q.created_at DESC
   LIMIT 50`;

/**
 * Required-vs-received, with the gaps highlighted (§7.5 Documents).
 *
 * A LEFT JOIN from the REQUIREMENTS, not from the documents: the whole point of
 * this tab is what is missing, and a join the other way can only ever show what
 * is there. Requirements join `dictionary_ref` by code because migration 10747
 * shipped `doc_type_code text` rather than the guide's `doc_type_ref_id`.
 */
const CLIENT_DOCUMENTS = `
  SELECT r.document_requirement_id, r.doc_type_code, r.is_mandatory, r.sort_order,
         d.name_en, d.name_fr,
         v.doc_id, v.created_at AS received_at,
         (v.doc_id IS NULL) AS missing
    FROM document_requirement r
    LEFT JOIN dictionary_ref d
           ON d.kind = 'DOCUMENT_TYPE' AND d.code = r.doc_type_code
    LEFT JOIN LATERAL (
      SELECT dv.doc_id, dv.created_at
        FROM document_vault dv
       WHERE dv.client_id = $1
         AND dv.doc_type_ref_id = d.ref_id
         AND dv.status <> 'ARCHIVED'
       ORDER BY dv.created_at DESC
       LIMIT 1
    ) v ON true
   WHERE r.is_active AND r.applies_to = 'CLIENT'
   ORDER BY (v.doc_id IS NULL) DESC, r.sort_order`;

/** Every correspondence-derived read carries the visibility predicate (§9.5). */
const interactionsSql = () => `
  SELECT m.email_message_id, m.direction, m.from_address, m.subject,
         m.received_at, t.email_thread_id
    FROM email_message m
    JOIN email_thread t ON t.email_thread_id = m.email_thread_id
    JOIN email_connection c ON c.email_connection_id = t.email_connection_id
   WHERE t.entity_ref = $2 AND ${visibility.clause("$1")}
   ORDER BY m.received_at DESC
   LIMIT 10`;

/**
 * KYC and screening (§7.5 Compliance).
 *
 * Reads what the party record already carries rather than recomputing anything
 * — §3.6 is explicit that recomputation belongs to party-360 and not to a
 * drawer that opens on every thread click.
 */
const CLIENT_COMPLIANCE = `
  SELECT c.is_active, c.niu, c.payment_terms_days, c.credit_limit,
         c.cached_overdue, c.merged_into_id, c.kyc_docs,
         (c.niu IS NULL OR c.niu = '')  AS niu_missing,
         (c.merged_into_id IS NOT NULL) AS is_merged,
         -- Registration numbers live in party_registration, not on the party
         -- row: a client can hold several (RCCM, trade licence, customs code)
         -- and flattening them onto client_master would pick one arbitrarily.
         (SELECT count(*) FROM party_registration pr
           WHERE pr.client_id = c.client_id)::int AS registrations
    FROM client_master c
   WHERE c.client_id = $1`;

const SUPPLIER_COMPLIANCE = `
  SELECT s.is_active, s.niu, s.is_non_resident, s.rating, s.payment_method,
         (s.niu IS NULL OR s.niu = '') AS niu_missing,
         (s.merged_into_id IS NOT NULL) AS is_merged
    FROM supplier_master s
   WHERE s.supplier_id = $1`;

const rows = (client, sql, params) =>
  client.query(sql, params).then((r) => r.rows).catch(() => []);

/**
 * One tab, one query.
 *
 * `not_built` is returned rather than an empty list for a combination that does
 * not exist yet — a supplier has no quotations tab, and saying "none" would be
 * a claim about the supplier rather than about the software.
 */
async function tabQuery(client, kind, id, tabName, userId, user = null) {
  const ref = `${kind}:${id}`;

  switch (`${tabName}:${kind}`) {
    case "money:client": {
      // P3-1. The Money tab is the same leak as the overview numbers, just
      // more of it. Withhold without running the invoice query so a mail-only
      // user does not even confirm how many open invoices exist.
      const { maySeeFinancials } = require("./mail-context.service");
      if (!(await maySeeFinancials(client, user))) {
        return { tab: "money", kind, invoices: [], aging: {}, withheld: true };
      }
      const invoices = await rows(client, CLIENT_MONEY, [id]);
      // Bucketed in JS from the single query rather than a second GROUP BY —
      // the rows are already here and there are at most a hundred of them.
      const aging = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
      for (const i of invoices) aging[i.bucket] = (aging[i.bucket] || 0) + Number(i.total_ttc || 0);
      return { tab: "money", kind, invoices, aging };
    }
    case "money:supplier": {
      const orders = await rows(client, SUPPLIER_MONEY, [id]);
      const outstanding = orders.reduce((n, p) => n + Number(p.outstanding || 0), 0);
      return { tab: "money", kind, purchase_orders: orders, outstanding };
    }

    case "operations:client":
      return { tab: "operations", kind, dossiers: await rows(client, CLIENT_OPS, [id]) };

    case "commercial:client":
      return { tab: "commercial", kind, quotations: await rows(client, CLIENT_COMMERCIAL, [id]) };

    case "documents:client": {
      const checklist = await rows(client, CLIENT_DOCUMENTS, [id]);
      return {
        tab: "documents", kind, checklist,
        missing: checklist.filter((d) => d.missing && d.is_mandatory).length,
        // What the "Chase missing documents" composer needs, already filtered.
        chaseable: checklist.filter((d) => d.missing && d.is_mandatory)
          .map((d) => ({ code: d.doc_type_code, name_en: d.name_en, name_fr: d.name_fr })),
      };
    }

    case "compliance:client":
      return { tab: "compliance", kind, ...(await rows(client, CLIENT_COMPLIANCE, [id]))[0] || {} };
    case "compliance:supplier":
      return { tab: "compliance", kind, ...(await rows(client, SUPPLIER_COMPLIANCE, [id]))[0] || {} };

    default:
      break;
  }

  if (tabName === "interactions") {
    // Fails closed: an unknown caller gets nothing rather than everything.
    if (!userId) return { tab: "interactions", kind, rows: [] };
    return { tab: "interactions", kind, rows: await rows(client, interactionsSql(), [userId, ref]) };
  }

  return { tab: tabName, kind, id, rows: [], not_built: true };
}

module.exports = {
  tabQuery,
  CLIENT_MONEY, SUPPLIER_MONEY, CLIENT_OPS, CLIENT_COMMERCIAL,
  CLIENT_DOCUMENTS, CLIENT_COMPLIANCE, SUPPLIER_COMPLIANCE, interactionsSql,
};
