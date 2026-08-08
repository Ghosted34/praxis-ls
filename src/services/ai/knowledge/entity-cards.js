/**
 * Tenant rows → compact text "cards" for semantic recall. Runs on a tenant
 * connection already bound to live/sandbox. Only knowledge-bearing entities;
 * exact/current values come from function-calling, not from these cards.
 * Each card carries a confidentiality tag so retrieval can filter per RBAC.
 */
"use strict";

// [sql, mapRow→card] per entity. Defensive: LIMIT and only-if-table-exists.
const BUILDERS = [
  {
    key: "dossier",
    sql: `SELECT d.ref, d.status, d.incoterm, d.pol, d.pod, c.name AS client
            FROM dossier d LEFT JOIN client_master c ON c.client_id = d.client_id
           ORDER BY d.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `dossier:${r.ref}`,
      title: `Operation file ${r.ref}`,
      confidentiality: "normal",
      text: `Operation file ${r.ref} for client ${r.client || "?"} — status ${r.status}, incoterm ${r.incoterm || "?"}, route ${r.pol || "?"}→${r.pod || "?"}.`,
    }),
  },
  {
    key: "client_master",
    sql: `SELECT ref, name, niu, payment_terms_days FROM client_master ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `client:${r.ref || r.name}`,
      title: `Client ${r.name}`,
      confidentiality: "normal",
      text: `Client ${r.name} (ref ${r.ref || "?"}, NIU ${r.niu || "?"}), payment terms ${r.payment_terms_days || "?"} days.`,
    }),
  },
  {
    key: "dictionary_item",
    sql: `SELECT code, label_fr, label_en, category, is_debours FROM dictionary_item ORDER BY code LIMIT $1`,
    card: (r) => ({
      ref: `dict:${r.code}`,
      title: `Dictionary item ${r.code}`,
      confidentiality: "normal",
      text: `Billing item ${r.code}: ${r.label_en || r.label_fr} (${r.category}${r.is_debours ? ", débours" : ""}).`,
    }),
  },
  // ── Expanded entity coverage ──
  // THE BREADTH FIX. The AI's knowledge base only covered 3 entity types, so
  // retrieval grounding was thin — the vector search covered docs and schema
  // but very few actual business records. These additions cover the high-value
  // entities the assistant is most often asked about.
  {
    key: "final_invoice",
    sql: `SELECT i.invoice_id, i.doc_number, i.status, i.total_ttc, c.name AS client, i.issued_at
            FROM final_invoice i LEFT JOIN client_master c ON c.client_id = i.client_id
           ORDER BY i.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `invoice:${r.doc_number || r.invoice_id}`,
      title: `Invoice ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Invoice ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF${r.issued_at ? `, issued ${new Date(r.issued_at).toLocaleDateString()}` : ""}.`,
    }),
  },
  {
    key: "quotation",
    sql: `SELECT q.quotation_id, q.doc_number, q.status, q.total_ttc, c.name AS client
            FROM quotation q LEFT JOIN client_master c ON c.client_id = q.client_id
           ORDER BY q.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `quotation:${r.doc_number || r.quotation_id}`,
      title: `Quotation ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Quotation ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "supplier_master",
    sql: `SELECT ref, name, niu FROM supplier_master ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `supplier:${r.ref || r.name}`,
      title: `Supplier ${r.name}`,
      confidentiality: "normal",
      text: `Supplier ${r.name} (ref ${r.ref || "?"}, NIU ${r.niu || "?"}).`,
    }),
  },
  {
    key: "purchase_order",
    sql: `SELECT po.po_id, po.doc_number, po.status, s.name AS supplier, po.total_ttc
            FROM purchase_order po LEFT JOIN supplier_master s ON s.supplier_id = po.supplier_id
           ORDER BY po.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `purchase_order:${r.doc_number || r.po_id}`,
      title: `Purchase Order ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Purchase order ${r.doc_number || "draft"} from ${r.supplier || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "employee",
    sql: `SELECT employee_id, full_name, position, department, status FROM employee ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `employee:${r.full_name}`,
      title: `Employee ${r.full_name}`,
      confidentiality: "confidential",
      text: `Employee ${r.full_name} — ${r.position || "?"}, ${r.department || "?"} department, status ${r.status || "active"}.`,
    }),
  },
  {
    key: "vehicle",
    sql: `SELECT vehicle_id, plate, make, model, status, vehicle_type FROM vehicle ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `vehicle:${r.plate}`,
      title: `Vehicle ${r.plate}`,
      confidentiality: "normal",
      text: `Vehicle ${r.plate} — ${r.make || ""} ${r.model || ""} (${r.vehicle_type || "?"}), status ${r.status || "?"}.`,
    }),
  },
  {
    key: "proforma",
    sql: `SELECT p.proforma_id, p.doc_number, p.status, p.total_ttc, c.name AS client
            FROM proforma p LEFT JOIN client_master c ON c.client_id = p.client_id
           ORDER BY p.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `proforma:${r.doc_number || r.proforma_id}`,
      title: `Proforma ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Proforma invoice ${r.doc_number || "draft"} for ${r.client || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "supplier_invoice",
    sql: `SELECT si.supplier_invoice_id, si.doc_number, si.status, si.total_ttc, s.name AS supplier
            FROM supplier_invoice si LEFT JOIN supplier_master s ON s.supplier_id = si.supplier_id
           ORDER BY si.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `supplier_invoice:${r.doc_number || r.supplier_invoice_id}`,
      title: `Supplier Invoice ${r.doc_number || "draft"}`,
      confidentiality: "normal",
      text: `Supplier invoice ${r.doc_number || "draft"} from ${r.supplier || "?"} — status ${r.status}, total ${r.total_ttc || 0} XAF.`,
    }),
  },
  {
    key: "lead",
    sql: `SELECT lead_id, company_name, contact_name, status, source FROM lead ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `lead:${r.company_name || r.contact_name}`,
      title: `Lead ${r.company_name || r.contact_name}`,
      confidentiality: "normal",
      text: `Lead: ${r.company_name || "?"} (contact ${r.contact_name || "?"}), source ${r.source || "?"}, status ${r.status || "?"}.`,
    }),
  },
  {
    key: "opportunity",
    sql: `SELECT o.opportunity_id, o.title, o.status, o.expected_value, c.name AS client
            FROM opportunity o LEFT JOIN client_master c ON c.client_id = o.client_id
           ORDER BY o.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `opportunity:${r.title}`,
      title: `Opportunity ${r.title}`,
      confidentiality: "normal",
      text: `Opportunity "${r.title}" with ${r.client || "?"} — status ${r.status}, expected value ${r.expected_value || 0} XAF.`,
    }),
  },
];

async function tableExists(client, name) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
    [name],
  );
  return rows.length > 0;
}

async function buildEntityCards(client, opts = {}) {
  const limit = opts.limitPerEntity || 500;
  const cards = [];
  for (const b of BUILDERS) {
    if (!(await tableExists(client, b.key))) continue;
    const { rows } = await client.query(b.sql, [limit]);
    for (const r of rows) cards.push(b.card(r));
  }
  return cards;
}

module.exports = { buildEntityCards, BUILDERS };
