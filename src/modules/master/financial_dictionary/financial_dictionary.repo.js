"use strict";
const { insertOne, updateOne, getById, page, TOTAL_COL, splitTotal } = require("../../../shared/db/query-helpers");
const { directionLetter, formatCode } = require("./financial_dictionary.rules");
// Actual spend per item is NET of reconciliation reversals — see shared/finance/cost-entry-sql.
const { netAmountSql } = require("../../../shared/finance/cost-entry-sql");
// An item's price is its STANDARD expense rate, never a column on the item (14120).
const { standardRateJoin, STANDARD_RATE_COLUMNS } = require("../expense_rate/standard-rate.sql");
const { clientHeadingJoin, CLIENT_HEADING_COLUMNS } = require("./client-heading.sql");

/* ── item + posting rules ──────────────────────────────────────────────────── */
const createItem = (c, d) => insertOne(c, "dictionary_item", d);
const createRule = (c, d) => insertOne(c, "posting_rule", d);
const updateItem = (c, id, patch) => updateOne(c, "dictionary_item", "dictionary_item_id", id, patch);
/** The raw row, for writes that need `before` exactly as stored. */
const getItemRow = (c, id) => getById(c, "dictionary_item", "dictionary_item_id", id);

/**
 * The item as every reader sees it: the row plus its standard rate under
 * `default_price` / `default_price_currency` / `default_price_from`.
 *
 * `STANDARD_RATE_COLUMNS` comes AFTER `di.*` on purpose. `di.*` still carries
 * the retired `default_price` column (NULL since 14120), and node-pg builds the
 * row object field by field, so the later alias is the value the caller gets.
 */
async function getItem(c, id) {
  const { rows } = await c.query(
    `SELECT di.*, ${STANDARD_RATE_COLUMNS}, ${CLIENT_HEADING_COLUMNS}
       FROM dictionary_item di ${standardRateJoin("di")} ${clientHeadingJoin("di")}
      WHERE di.dictionary_item_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Mint the next code for a direction: "#<L><NNN>" (R/E/D/A + zero-padded serial).
 *
 * GAP-FILLING (meeting 5, 01:20:04). The serial is the LOWEST number not in use
 * for that letter, not the highest + 1. A line whose direction changes moves to
 * the new letter and gives its old number back ("it frees up the number so that
 * another person can use it"), and the next line of that letter takes it. The
 * audit trail keeps the old code against the item that carried it, and a
 * document already issued keeps the code it printed, so a reused number never
 * rewrites history.
 *
 * Mixed legacy codes ("#-1119") never match the `^#L[0-9]+$` pattern and so
 * never block or occupy a serial. A collision between two concurrent creates is
 * still possible; the callers retry on 23505 exactly as before.
 */
async function nextCode(c, direction) {
  const letter = directionLetter(direction);
  const { rows } = await c.query(
    `WITH used AS (
       SELECT (substring(code::text FROM 3))::int AS n
         FROM dictionary_item
        WHERE code::text ~ $1
     )
     SELECT COALESCE(
       (SELECT MIN(g) FROM generate_series(1, (SELECT COALESCE(MAX(n), 0) + 1 FROM used)) g
         WHERE NOT EXISTS (SELECT 1 FROM used WHERE used.n = g)),
       1) AS n`,
    [`^#${letter}[0-9]+$`],
  );
  return formatCode(direction, Number(rows[0] && rows[0].n ? rows[0].n : 1));
}

/**
 * The shared finder's query (MOD-05). One endpoint behind one component, used
 * from costing, quotation, cash request, supplier invoice and the dictionary
 * itself — so "what is this charge called in the system?" has one answer
 * everywhere.
 *
 * WHY THIS IS NOT `listItems({ q })`. That one is `ILIKE '%q%'` over code +
 * label_fr + label_en: it finds nothing unless you already know roughly what
 * the catalogue calls the thing. Operations staff do not. They type
 * "surestarie" for Demurrage, "demurage" with one r, "gasoil" for Fuel, "BAD"
 * for the delivery order, or the legacy "#-1119" off a filed document.
 *
 * Four matchers, unioned, then ranked:
 *   1. an exact keyword hit (`keywords &&`) — the alternates seeded in 9081,
 *      including every superseded and legacy code. Indexed GIN, and the
 *      strongest signal there is, so it outranks everything.
 *   2. a code prefix/substring — someone pasting a code wants that line.
 *   3. a plain substring on either label — the old behaviour, kept.
 *   4. trigram similarity over label_fr / label_en / description, which is what
 *      survives a typo. `%` uses pg_trgm's threshold and the GIN indexes from
 *      0633.
 *
 * `similarity()` and `%` are unqualified: pg_trgm lives in `public` (0504) and
 * the runtime search_path is `<schema>, public` (middleware/tenant-context).
 *
 * Inactive lines are excluded unless asked for — a superseded duplicate must
 * stop appearing in pickers while staying readable on the documents that
 * already reference it.
 */
async function searchItems(c, { q, limit = 20, service_type_id = null, direction = null, include_inactive = false } = {}) {
  const term = String(q || "").trim();
  if (!term) return [];
  const params = [term, term.toLowerCase(), Math.min(Number(limit) || 20, 50)];
  const wh = [];
  if (!include_inactive) wh.push("di.is_active = true");
  if (direction) { params.push(String(direction).toUpperCase()); wh.push(`di.direction = $${params.length}`); }
  let join = "";
  if (service_type_id) {
    params.push(service_type_id);
    join = `JOIN service_type_dictionary_item sti
              ON sti.dictionary_item_id = di.dictionary_item_id
             AND sti.service_type_id = $${params.length}`;
  }
  const { rows } = await c.query(
    `SELECT di.dictionary_item_id, di.code, di.label_fr, di.label_en, di.description,
            di.direction, di.category, di.subcategory, di.unit_of_measure,
            di.is_disbursement, di.is_billable, di.varies_by_equipment, di.is_active,
            ${STANDARD_RATE_COLUMNS}, ${CLIENT_HEADING_COLUMNS}, di.client_heading_ref_id,
            GREATEST(
              CASE WHEN di.keywords && ARRAY[$2] THEN 1.0 ELSE 0 END,
              CASE WHEN di.code::text ILIKE '%' || $1 || '%' THEN 0.95 ELSE 0 END,
              similarity(di.label_en, $1), similarity(di.label_fr, $1),
              similarity(COALESCE(di.description, ''), $1) * 0.6
            ) AS score
       FROM dictionary_item di ${join} ${standardRateJoin("di")} ${clientHeadingJoin("di")}
      ${wh.length ? "WHERE " + wh.join(" AND ") + " AND" : "WHERE"} (
            di.keywords && ARRAY[$2]
         OR di.code::text ILIKE '%' || $1 || '%'
         OR di.label_en ILIKE '%' || $1 || '%'
         OR di.label_fr ILIKE '%' || $1 || '%'
         OR di.label_en % $1 OR di.label_fr % $1 OR COALESCE(di.description, '') % $1)
      ORDER BY score DESC, di.label_en
      LIMIT $3`,
    params,
  );
  return rows;
}

/**
 * Posting rules resolved with account labels, so the 360 can show
 * "6271 — Customs & transit charges" without a second round-trip.
 */
async function listRules(c, id) {
  const { rows } = await c.query(
    `SELECT pr.*, da.label_fr AS debit_label, ca.label_fr AS credit_label,
            da.class AS debit_class, ca.class AS credit_class
       FROM posting_rule pr
       LEFT JOIN chart_of_accounts da ON da.code = pr.debit_account
       LEFT JOIN chart_of_accounts ca ON ca.code = pr.credit_account
      WHERE pr.dictionary_item_id = $1
      ORDER BY pr.applies_context`,
    [id],
  );
  return rows;
}
async function deleteRules(c, id) { await c.query("DELETE FROM posting_rule WHERE dictionary_item_id = $1", [id]); }

/* ── service-type tiers (the Basic/Advanced/Full mapping) ───────────────────── */
async function listTiers(c, id) {
  const { rows } = await c.query(
    `SELECT sti.service_type_id, sti.tier, sti.sort_order,
            st.key AS service_key, st.name_fr, st.name_en, st.territory
       FROM service_type_dictionary_item sti
       JOIN service_type st ON st.service_type_id = sti.service_type_id
      WHERE sti.dictionary_item_id = $1
      ORDER BY sti.tier, st.name_fr`,
    [id],
  );
  return rows;
}
async function replaceTiers(c, id, tiers) {
  await c.query("DELETE FROM service_type_dictionary_item WHERE dictionary_item_id = $1", [id]);
  for (const t of tiers) {
    await c.query(
      `INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (service_type_id, dictionary_item_id) DO UPDATE SET tier = EXCLUDED.tier, sort_order = EXCLUDED.sort_order`,
      [t.service_type_id, id, t.tier || "BASIC", t.sort_order ?? 100],
    );
  }
}

/* ── list with the new facets ──────────────────────────────────────────────── */
async function listItems(c, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.include_inactive === "true" || q.include_inactive === true) { /* all */ } else { wh.push("di.is_active = true"); }
  if (q.category) { params.push(q.category); wh.push("di.category = $" + params.length); }
  if (q.direction) { params.push(String(q.direction).toUpperCase()); wh.push("di.direction = $" + params.length); }
  if (q.applicability_mode) { params.push(String(q.applicability_mode).toUpperCase()); wh.push("di.applicability_mode = $" + params.length); }
  if (q.q) {
    params.push("%" + q.q + "%");
    wh.push("(di.code::text ILIKE $" + params.length + " OR di.label_fr ILIKE $" + params.length + " OR di.label_en ILIKE $" + params.length + ")");
  }
  // Filter by a service type (and optionally a tier bundle: nested — BASIC ⊆
  // ADVANCED ⊆ FULL). rank lets "ADVANCED" pull BASIC+ADVANCED.
  let join = "";
  if (q.service_type_id) {
    params.push(q.service_type_id);
    join = "JOIN service_type_dictionary_item sti ON sti.dictionary_item_id = di.dictionary_item_id AND sti.service_type_id = $" + params.length;
    if (q.tier) {
      const rank = { BASIC: 1, ADVANCED: 2, FULL: 3 }[String(q.tier).toUpperCase()] || 3;
      wh.push("(CASE sti.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END) <= " + rank);
    }
  }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await c.query(
    `SELECT di.*, ${STANDARD_RATE_COLUMNS}, ${CLIENT_HEADING_COLUMNS}
       FROM dictionary_item di ${join} ${standardRateJoin("di")} ${clientHeadingJoin("di")}
       ${where} ORDER BY di.code LIMIT $1 OFFSET $2`,
    params,
  );
  return rows;
}

/* ── usage across the system (counts now; money rollups are PR2) ────────────── */
async function usageCounts(c, id) {
  const { rows } = await c.query(
    `SELECT
       (SELECT COUNT(*) FROM costing_line          WHERE dictionary_item_id = $1) AS costing_lines,
       (SELECT COUNT(*) FROM cash_request_line     WHERE dictionary_item_id = $1) AS cash_request_lines,
       (SELECT COUNT(*) FROM purchase_order_item   WHERE dictionary_item_id = $1) AS purchase_order_items,
       (SELECT COUNT(*) FROM invoice_line          WHERE dictionary_item_id = $1) AS invoice_lines,
       (SELECT COUNT(*) FROM supplier_invoice_line WHERE dictionary_item_id = $1) AS supplier_invoice_lines,
       (SELECT COUNT(*) FROM cost_entry            WHERE dictionary_item_id = $1) AS cost_entries,
       (SELECT COUNT(*) FROM expense_rate          WHERE dictionary_item_id = $1) AS expense_rates`,
    [id],
  );
  const r = rows[0] || {};
  const out = {};
  for (const k of Object.keys(r)) out[k] = Number(r[k]);
  return out;
}

/* ── USAGE ROWS — the lines behind each 360 tile ────────────────────────────
 *
 * The tiles above are `usageCounts`; these are the rows those counts count, one
 * query per tile, so "Costings 14" opens exactly fourteen rows. Same table and
 * the same WHERE as the count, nothing else: a filter added here and not there
 * (hiding cancelled documents, say) would make the list disagree with the
 * number the reader clicked. The joins are LEFT for the same reason — a line
 * whose file is still a DRAFT has no visible file ref, but it is still counted,
 * so it is still listed.
 *
 * One page at a time with the true total (`X-Total-Count`). A core charge sits
 * on thousands of costing lines, and a list capped at "the first 200" would say
 * "Showing 1–20 of 200" under a tile that says 3,412.
 *
 * Every document row has one shape — document, file, client (or supplier for a
 * PO), line, amount — so the dialog draws all four document kinds with one
 * table. Rates are not documents and have their own shape.
 */
const USAGE_DOC_SQL = {
  costings: `
    SELECT cl.costing_line_id AS row_id, co.costing_id AS doc_id, co.doc_number, co.status,
           NULL::text AS doc_type, co.created_at AS doc_date, co.currency,
           (cl.qty * cl.unit_cost) AS amount, cl.label,
           d.dossier_id, d.ref AS dossier_ref, cm.client_id AS party_id, cm.name AS party_name,
           ${TOTAL_COL}
      FROM costing_line cl
      JOIN costing co ON co.costing_id = cl.costing_id
      LEFT JOIN dossier_visible d ON d.dossier_id = co.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = d.client_id
     WHERE cl.dictionary_item_id = $1
     ORDER BY co.created_at DESC, cl.costing_line_id
     LIMIT $2 OFFSET $3`,
  cash_requests: `
    SELECT crl.cash_request_line_id AS row_id, cr.cash_request_id AS doc_id, cr.doc_number, cr.status,
           NULL::text AS doc_type, cr.created_at AS doc_date, cr.currency,
           crl.budget_amount AS amount, crl.label,
           d.dossier_id, d.ref AS dossier_ref, cm.client_id AS party_id, cm.name AS party_name,
           ${TOTAL_COL}
      FROM cash_request_line crl
      JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
      LEFT JOIN dossier_visible d ON d.dossier_id = cr.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = d.client_id
     WHERE crl.dictionary_item_id = $1
     ORDER BY cr.created_at DESC, crl.cash_request_line_id
     LIMIT $2 OFFSET $3`,
  // The invoice's own client first — an invoice need not have a file — then
  // the file's. `$4` is the invoice types this viewer may see (the controller
  // resolves it from their grants).
  invoices: `
    SELECT il.invoice_line_id AS row_id, inv.invoice_id AS doc_id, inv.doc_number, inv.status,
           inv.type AS doc_type, inv.created_at AS doc_date, inv.currency,
           (il.qty * il.unit_price) AS amount, il.label,
           d.dossier_id, d.ref AS dossier_ref, cm.client_id AS party_id, cm.name AS party_name,
           ${TOTAL_COL}
      FROM invoice_line il
      JOIN invoice inv ON inv.invoice_id = il.invoice_id
      LEFT JOIN dossier_visible d ON d.dossier_id = inv.dossier_id
      LEFT JOIN client_master cm ON cm.client_id = COALESCE(inv.client_id, d.client_id)
     WHERE il.dictionary_item_id = $1 AND inv.type = ANY($4::text[])
     ORDER BY inv.created_at DESC, il.invoice_line_id
     LIMIT $2 OFFSET $3`,
  // The party on a PO is the supplier it was raised on, not the file's client.
  purchase_orders: `
    SELECT poi.po_item_id AS row_id, po.po_id AS doc_id, po.doc_number, po.status,
           NULL::text AS doc_type, po.created_at AS doc_date, po.currency,
           (poi.qty * poi.unit_price) AS amount, poi.label,
           d.dossier_id, d.ref AS dossier_ref, sm.supplier_id AS party_id, sm.name AS party_name,
           ${TOTAL_COL}
      FROM purchase_order_item poi
      JOIN purchase_order po ON po.po_id = poi.po_id
      LEFT JOIN dossier_visible d ON d.dossier_id = po.dossier_id
      LEFT JOIN supplier_master sm ON sm.supplier_id = po.supplier_id
     WHERE poi.dictionary_item_id = $1
     ORDER BY po.created_at DESC, poi.po_item_id
     LIMIT $2 OFFSET $3`,
};

/** Open rates first (the ones in use), then newest first. */
const USAGE_RATES_SQL = `
    SELECT er.expense_rate_id AS row_id, er.rate, er.currency, er.effective_from, er.effective_to, er.note,
           rp.name AS provider_name, rp.kind AS provider_kind,
           ct.code AS container_type_code, COALESCE(ct.name_en, ct.name_fr) AS container_type_name,
           ${TOTAL_COL}
      FROM expense_rate er
      LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
      LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id
     WHERE er.dictionary_item_id = $1
     ORDER BY (er.effective_to IS NULL) DESC, er.effective_from DESC, er.expense_rate_id
     LIMIT $2 OFFSET $3`;

/**
 * One page of the rows behind one usage tile, plus the true total.
 * `invoiceTypes` is only read for `invoices`.
 */
async function usageRows(c, id, kind, q = {}, { invoiceTypes = [] } = {}) {
  const { limit, offset } = page(q);
  if (kind === "rates") {
    const { rows } = await c.query(USAGE_RATES_SQL, [id, limit, offset]);
    return splitTotal(rows);
  }
  const sql = USAGE_DOC_SQL[kind];
  if (!sql) return { rows: [], total: 0 };
  const params = kind === "invoices" ? [id, limit, offset, invoiceTypes] : [id, limit, offset];
  const { rows } = await c.query(sql, params);
  return splitTotal(rows);
}

/* ── SPEND OVER A PERIOD — three lenses, one item, grouped by month ─────────
 *
 * Each lens reads the document that owns that stage of the money, and dates it
 * by the field that stage is actually keyed on. Getting the DATE right matters
 * more than the amount: a costing drafted in March for a job posted in June
 * belongs in March's estimate and June's actual, and a naive created_at on all
 * three would pile the whole story into one month.
 *
 *   estimated  costing_line.qty * unit_cost, dated by its costing.created_at
 *   committed  purchase_order_item (qty * unit_price) on a non-CANCELLED PO,
 *              dated by the PO; PLUS cash_request_line.budget_amount on a
 *              SUBMITTED/APPROVED (or later) cash request
 *   actual     cost_entry.amount, dated by the journal_entry's entry_date —
 *              the REAL posting date — falling back to cost_entry.created_at
 *              when the entry is missing (a cost recorded outside a posting).
 *
 * All three are `>= from AND < to + 1 day` so an inclusive `to` really includes
 * that whole day regardless of the column's timestamptz/date type.
 */
const MONTH = (expr) => `to_char((${expr})::date, 'YYYY-MM')`;

async function spendEstimated(c, id, from, to, dossierId = null) {
  const { rows } = await c.query(
    `SELECT ${MONTH("co.created_at")} AS month,
            COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS amount,
            COUNT(*) AS count
       FROM costing_line cl
       JOIN costing co ON co.costing_id = cl.costing_id
      WHERE cl.dictionary_item_id = $1
        AND co.created_at >= $2::date AND co.created_at < ($3::date + 1)
        AND ($4::uuid IS NULL OR co.dossier_id = $4::uuid)
      GROUP BY 1 ORDER BY 1`,
    [id, from, to, dossierId],
  );
  return rows;
}

async function spendCommitted(c, id, from, to, dossierId = null) {
  const { rows } = await c.query(
    `SELECT month, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(cnt), 0) AS count FROM (
       SELECT ${MONTH("po.created_at")} AS month, SUM(poi.qty * poi.unit_price) AS amount, COUNT(*) AS cnt
         FROM purchase_order_item poi
         JOIN purchase_order po ON po.po_id = poi.po_id
        WHERE poi.dictionary_item_id = $1
          AND po.status <> 'CANCELLED'
          AND po.created_at >= $2::date AND po.created_at < ($3::date + 1)
          AND ($4::uuid IS NULL OR po.dossier_id = $4::uuid)
        GROUP BY 1
       UNION ALL
       SELECT ${MONTH("cr.created_at")} AS month, SUM(crl.budget_amount) AS amount, COUNT(*) AS cnt
         FROM cash_request_line crl
         JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
        WHERE crl.dictionary_item_id = $1
          AND cr.status IN ('SUBMITTED','APPROVED','DISBURSED','JUSTIFIED')
          AND cr.created_at >= $2::date AND cr.created_at < ($3::date + 1)
          AND ($4::uuid IS NULL OR cr.dossier_id = $4::uuid)
        GROUP BY 1
     ) u GROUP BY month ORDER BY month`,
    [id, from, to, dossierId],
  );
  return rows;
}

async function spendActual(c, id, from, to, dossierId = null) {
  const { rows } = await c.query(
    `SELECT ${MONTH("COALESCE(je.entry_date, ce.created_at)")} AS month,
            COALESCE(${netAmountSql("ce")}, 0) AS amount,
            COUNT(*) AS count
       FROM cost_entry ce
       LEFT JOIN journal_entry je ON je.entry_id = ce.entry_id
      WHERE ce.dictionary_item_id = $1
        AND COALESCE(je.entry_date, ce.created_at::date) >= $2::date
        AND COALESCE(je.entry_date, ce.created_at::date) <= $3::date
        AND ($4::uuid IS NULL OR ce.dossier_id = $4::uuid)
      GROUP BY 1 ORDER BY 1`,
    [id, from, to, dossierId],
  );
  return rows;
}

/**
 * The four lenses' rows as one set — `$1` item, `$2`/`$3` the window, `$5` one
 * operations file or NULL. Shared by the capped list under the Spend chart and
 * by the paged drill-in its tiles open, so the two cannot disagree about which
 * documents a lens holds. Each branch is its lens's SUM query (`spendEstimated`,
 * `spendCommitted`, `spendActual`) with the same table, statuses and date, one
 * row per line — which is why a lens's row count is the count on its tile.
 */
const SPEND_DOCS_UNION = `
       SELECT 'estimated' AS lens, 'costing' AS doc_type, co.costing_id AS doc_id,
              co.doc_number, co.status, co.dossier_id, d.ref AS dossier_ref,
              (cl.qty * cl.unit_cost) AS amount, co.currency, co.created_at::date AS doc_date, cl.label
         FROM costing_line cl
         JOIN costing co ON co.costing_id = cl.costing_id
         LEFT JOIN dossier_visible d ON d.dossier_id = co.dossier_id
        WHERE cl.dictionary_item_id = $1 AND co.created_at >= $2::date AND co.created_at < ($3::date + 1)
          AND ($5::uuid IS NULL OR co.dossier_id = $5::uuid)
       UNION ALL
       SELECT 'committed', 'purchase_order', po.po_id, po.doc_number, po.status, po.dossier_id, d.ref,
              (poi.qty * poi.unit_price), NULL, po.created_at::date, poi.label
         FROM purchase_order_item poi
         JOIN purchase_order po ON po.po_id = poi.po_id
         LEFT JOIN dossier_visible d ON d.dossier_id = po.dossier_id
        WHERE poi.dictionary_item_id = $1 AND po.status <> 'CANCELLED'
          AND po.created_at >= $2::date AND po.created_at < ($3::date + 1)
          AND ($5::uuid IS NULL OR po.dossier_id = $5::uuid)
       UNION ALL
       SELECT 'committed', 'cash_request', cr.cash_request_id, cr.doc_number, cr.status, cr.dossier_id, d.ref,
              crl.budget_amount, NULL, cr.created_at::date, crl.label
         FROM cash_request_line crl
         JOIN cash_request cr ON cr.cash_request_id = crl.cash_request_id
         LEFT JOIN dossier_visible d ON d.dossier_id = cr.dossier_id
        WHERE crl.dictionary_item_id = $1 AND cr.status IN ('SUBMITTED','APPROVED','DISBURSED','JUSTIFIED')
          AND cr.created_at >= $2::date AND cr.created_at < ($3::date + 1)
          AND ($5::uuid IS NULL OR cr.dossier_id = $5::uuid)
       UNION ALL
       SELECT 'actual', 'cost_entry', ce.cost_entry_id, je.source_doc_ref, je.status, ce.dossier_id, d.ref,
              ce.amount, NULL, COALESCE(je.entry_date, ce.created_at::date), ce.category
         FROM cost_entry ce
         LEFT JOIN journal_entry je ON je.entry_id = ce.entry_id
         LEFT JOIN dossier_visible d ON d.dossier_id = ce.dossier_id
        WHERE ce.dictionary_item_id = $1
          AND COALESCE(je.entry_date, ce.created_at::date) >= $2::date
          AND COALESCE(je.entry_date, ce.created_at::date) <= $3::date
          AND ($5::uuid IS NULL OR ce.dossier_id = $5::uuid)
`;

/**
 * The documents behind the numbers — the list under the Spend chart.
 *
 * Deliberately capped and ordered newest-first rather than paged: this is the
 * "show me the receipts" list under a chart, not a browsable ledger. The tiles
 * above it open the paged version (`spendDocumentsPage`) for the whole set.
 */
async function spendDocuments(c, id, from, to, limit = 100, dossierId = null) {
  const { rows } = await c.query(
    `SELECT * FROM (${SPEND_DOCS_UNION}) docs ORDER BY doc_date DESC, lens LIMIT $4`,
    [id, from, to, limit, dossierId],
  );
  return rows;
}

/**
 * One page of the same documents, optionally one lens, with the true total —
 * what the Spend tab's tiles open. `lens` NULL is every lens (the Documents
 * tile). Ordered as the capped list is, with the id as the tie-break a stable
 * page needs.
 */
async function spendDocumentsPage(c, id, from, to, { lens = null, dossierId = null, limit, offset }) {
  const { rows } = await c.query(
    `SELECT *, ${TOTAL_COL} FROM (${SPEND_DOCS_UNION}) docs
      WHERE ($6::text IS NULL OR lens = $6::text)
      ORDER BY doc_date DESC, lens, doc_id
      LIMIT $4 OFFSET $7`,
    [id, from, to, limit, dossierId, lens, offset],
  );
  return splitTotal(rows);
}

/* ── COST EVOLUTION — the effective-dated rate history per item + provider ─── */
async function rateHistory(c, id) {
  const { rows } = await c.query(
    `SELECT er.*, rp.name AS provider_name, rp.kind AS provider_kind_resolved,
            ct.code AS container_type_code, COALESCE(ct.name_en, ct.name_fr) AS container_type_name
       FROM expense_rate er
       LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
       LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id
      WHERE er.dictionary_item_id = $1
      ORDER BY er.effective_from ASC, er.created_at ASC`,
    [id],
  );
  return rows;
}
/** The open (never-expired) rate for one provider/container-type series. */
async function openRate(c, id, { rateProviderId = null, containerTypeRefId = null }) {
  const { rows } = await c.query(
    `SELECT * FROM expense_rate
      WHERE dictionary_item_id = $1
        AND effective_to IS NULL
        AND rate_provider_id IS NOT DISTINCT FROM $2
        AND container_type_ref_id IS NOT DISTINCT FROM $3
      ORDER BY effective_from DESC LIMIT 1`,
    [id, rateProviderId, containerTypeRefId],
  );
  return rows[0] || null;
}
const insertRate = (c, d) => insertOne(c, "expense_rate", d);
const expireRate = (c, rateId, effectiveTo) =>
  updateOne(c, "expense_rate", "expense_rate_id", rateId, { effective_to: effectiveTo });

/* ── IMPORT — the reference data a row is validated against ─────────────────
 * One round-trip per catalogue rather than one per row: a 500-row upload
 * validated row-by-row would be 1500 lookups against three small tables. */
async function postableAccounts(c) {
  const { rows } = await c.query(
    "SELECT code, label_fr, class FROM chart_of_accounts WHERE is_postable = true AND is_active IS DISTINCT FROM false ORDER BY code",
  );
  return rows;
}
async function taxCodeIndex(c) {
  const { rows } = await c.query("SELECT tax_code_id, code, rate_percent FROM tax_code ORDER BY code");
  return rows;
}
async function serviceTypeIndex(c) {
  const { rows } = await c.query("SELECT service_type_id, key, name_fr, name_en FROM service_type WHERE is_active ORDER BY key");
  return rows;
}

/* ── dictionary_ref: the seeded-but-editable registry behind dropdowns ──────── */
async function listRefs(c, kind, includeInactive = false) {
  const wh = ["kind = $1"];
  if (!includeInactive) wh.push("is_active = true");
  const { rows } = await c.query(
    `SELECT * FROM dictionary_ref WHERE ${wh.join(" AND ")} ORDER BY sort_order, name_fr`,
    [kind],
  );
  return rows;
}
const createRef = (c, d) => insertOne(c, "dictionary_ref", d);
const updateRef = (c, id, patch) => updateOne(c, "dictionary_ref", "ref_id", id, patch);
const getRef = (c, id) => getById(c, "dictionary_ref", "ref_id", id);

module.exports = {
  createItem, createRule, updateItem, getItem, getItemRow, nextCode,
  listRules, deleteRules, listTiers, replaceTiers,
  listItems, searchItems, usageCounts, usageRows,
  spendEstimated, spendCommitted, spendActual, spendDocuments, spendDocumentsPage,
  rateHistory, openRate, insertRate, expireRate,
  postableAccounts, taxCodeIndex, serviceTypeIndex,
  listRefs, createRef, updateRef, getRef,
};
