/**
 * Document templates (Studio backend, doc/DOCUMENT_TEMPLATES_PLAN.md §2/§6).
 * Resolves per-(docType, entity_id) config over the branding/entity defaults,
 * renders a template to HTML (live preview) or to a real, vaulted PDF (generate),
 * and lists real records for the preview picker. Config lives in the generic
 * settings store under section "document_template", key "<docType>:<entity|default>".
 */
"use strict";
const settings = require("../../security/setting/setting.service");
const registry = require("../../../services/documents/templates/registry");
const kit = require("../../../services/documents/templates/kit");
const pdf = require("../../../services/pdf.service");
const storage = require("../../../services/storage.service");
const emailSvc = require("../../../services/email.service");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

// Own section — NOT "document_template", which carries a legacy name/status/
// body_html validator (setting.rules.js) for the old raw template editor.
const SECTION = "document_template_config";
const keyOf = (docType, entityId) => `${docType}:${entityId || "default"}`;

// settings.get throws NOT_FOUND when a key is absent (the common "unconfigured"
// case) — swallow that into null so an unconfigured template still resolves.
async function safeGet(client, key) {
  try { return await settings.get(client, SECTION, key); } catch { return null; }
}

const list = () => registry.list();

const LOGO_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif" };

// Turn a stored logo reference into something that renders EVERYWHERE — the live
// preview iframe, the Puppeteer-rendered PDF (which has no page origin, so a
// relative /media URL never loads), and emailed HTML. We inline the bytes as a
// base64 data URI. `ref` is either a storage key or a /media/<key> public URL.
async function resolveLogo(ref) {
  if (!ref) return null;
  if (/^data:/i.test(ref)) return ref;
  if (/^https?:/i.test(ref)) return ref; // remote/CDN URL — used as-is
  const key = String(ref).replace(/^\/media\//, "").replace(/^\/+/, "");
  try {
    const buf = await storage.get(key);
    if (buf && buf.length) {
      const ext = (key.split(".").pop() || "png").toLowerCase();
      return `data:${LOGO_MIME[ext] || "image/png"};base64,${buf.toString("base64")}`;
    }
  } catch { /* fall through to the raw ref */ }
  return ref;
}

// Tenant-wide letterhead logo reference (Appearance → logo_url), used when a
// corporate entity has no per-entity logo of its own. Most tenants set only the
// branding logo, so without this the documents fall back to the brand *name*.
async function brandingLogoRef(client) {
  try {
    const { rows } = await client.query(
      "SELECT value FROM setting WHERE section = 'appearance' AND key = 'logo_url' LIMIT 1",
    );
    const v = rows[0] && rows[0].value;
    return v ? (typeof v === "string" ? v : String(v)) : null;
  } catch { return null; }
}

/**
 * The tenant's active-currency catalogue (code → { symbol, decimals, name }),
 * used to render the currency SYMBOL (e.g. "FCFA") and the right fraction
 * digits instead of a hardcoded "XAF" + 2 decimals. Falls back to an empty map
 * so a tenant whose currency master is empty still renders the raw code.
 */
async function currencyCatalog(client) {
  try {
    const { rows } = await client.query(
      "SELECT code, symbol, name, decimals FROM currency WHERE is_active = true",
    );
    const m = {};
    for (const r of rows) m[r.code.trim()] = { symbol: r.symbol || r.code.trim(), name: r.name, decimals: Number.isInteger(r.decimals) ? r.decimals : 2 };
    return m;
  } catch {
    /* @silent:storage — an unreadable currency master must not fail the render;
       the document falls back to the raw ISO code + 2 decimals. */
    return {};
  }
}

async function resolveEntity(client, entityId) {
  const q = entityId
    ? await client.query("SELECT * FROM corporate_entity WHERE entity_id = $1", [entityId])
    : await client.query("SELECT * FROM corporate_entity ORDER BY created_at LIMIT 1");
  const entity = q.rows[0] || {};
  const ref = entity.logo_light_ref || (await brandingLogoRef(client));
  return { entity, brand: { logo_url: await resolveLogo(ref) } };
}

/** entity override merged over the tenant default (entity_id = null). */
async function savedConfig(client, docType, entityId) {
  const def = await safeGet(client, keyOf(docType, null));
  const ov = entityId ? await safeGet(client, keyOf(docType, entityId)) : null;
  return { ...(def && def.value ? def.value : {}), ...(ov && ov.value ? ov.value : {}) };
}

async function resolveCfg(client, docType, entityId, override) {
  const { entity, brand } = await resolveEntity(client, entityId);
  const saved = await savedConfig(client, docType, entityId);
  const cfg = kit.mergeCfg(brand, { ...saved, ...(override || {}) });
  // Currency catalogue + the entity's default currency, so templates render the
  // symbol ("FCFA") and correct decimals, and fall back to the entity's base
  // currency (not a hardcoded XAF) when a document has no currency column.
  const currencies = await currencyCatalog(client);
  cfg.currencies = currencies;
  const base = (entity.default_currency || "").trim() || "XAF";
  cfg.base_currency = base;
  const b = currencies[base];
  entity.default_currency_decimals = b ? b.decimals : 2;
  return { cfg, entity };
}

async function getConfig(client, { docType, entityId }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const def = await safeGet(client, keyOf(docType, null));
  const ov = entityId ? await safeGet(client, keyOf(docType, entityId)) : null;
  const { entity } = await resolveEntity(client, entityId);
  return {
    docType, entity_id: entityId || null, title: tpl.title, fields: tpl.fields || [],
    tenant_default: (def && def.value) || {},
    entity_override: ov ? ov.value : null,
    defaults: kit.defaults({ logo_url: await resolveLogo(entity.logo_light_ref || (await brandingLogoRef(client))) }),
  };
}

async function setConfig(client, { docType, entityId, config, actor }) {
  if (!registry.get(docType)) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  await settings.put(client, { section: SECTION, key: keyOf(docType, entityId), value: config || {}, actor });
  return { ok: true, docType, entity_id: entityId || null };
}

/* ── record loading (real records for the preview picker / generate) ────────── */
const INVOICE_TYPE = { FINAL_INVOICE: "FINAL", CREDIT_NOTE: "CREDIT_NOTE" };
// docTypes with their own head table (label column for the picker).
const SIMPLE = {
  PROFORMA_ADVANCE: { table: "advance", pk: "advance_id", label: null },
  QUOTATION: { table: "quotation", pk: "quotation_id", label: "doc_number" },
  PAYMENT_RECEIPT: { table: "payment_receipt", pk: "receipt_id", label: null },
  PROPOSAL: { table: "proposal", pk: "proposal_id", label: "title" },
  SUPPLIER_INVOICE: { table: "supplier_invoice", pk: "supplier_invoice_id", label: "doc_number" },
  PURCHASE_ORDER: { table: "purchase_order", pk: "po_id", label: "doc_number" },
  PURCHASE_REQUEST: { table: "purchase_request", pk: "pr_id", label: "doc_number" },
  CASH_REQUEST: { table: "cash_request", pk: "cash_request_id", label: "doc_number" },
  COSTING: { table: "costing", pk: "costing_id", label: "doc_number" },
  REGIE_ADVANCE: { table: "regie_advance", pk: "regie_advance_id", label: null },
  WORK_ORDER: { table: "work_order", pk: "work_order_id", label: null },
  EMPLOYMENT_CONTRACT: { table: "hr_contract", pk: "hr_contract_id", label: null },
  SOP_DOCUMENT: { table: "sop_document", pk: "sop_document_id", label: "title" },
  DELIVERY_NOTE: { table: "delivery_note", pk: "delivery_note_id", label: "doc_number" },
  TRANSIT_ORDER: { table: "transit_order", pk: "transit_order_id", label: "ot_number" },
  GRN: { table: "grn_inbound", pk: "grn_inbound_id", label: null },
  GOODS_RECEIVED: { table: "goods_received_note", pk: "grn_id", label: "doc_number" },
  CYCLE_COUNT_SHEET: { table: "cycle_count", pk: "cycle_count_id", label: null },
  TRIP_SHEET: { table: "fleet_dispatch", pk: "fleet_dispatch_id", label: null },
};
const clientLines = (r) => [r.client_niu && `NIU ${r.client_niu}`, r.client_rccm && `RCCM ${r.client_rccm}`].filter(Boolean);
const humanize = (s) => String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const RECEIPT_METHOD = { BANK: "Virement / Bank transfer", CASH: "Espèces / Cash", MOBILE_MONEY: "Mobile money", CHEQUE: "Chèque / Cheque" };

async function records(client, docType) {
  // Defensive: a missing/renamed table (or a schema behind on migrations) must
  // degrade the picker to "no records", never 500 the Studio.
  try {
    if (INVOICE_TYPE[docType]) {
      const { rows } = await client.query(
        "SELECT invoice_id AS id, COALESCE(doc_number, LEFT(invoice_id::text, 8)) AS label FROM invoice WHERE type = $1 ORDER BY created_at DESC LIMIT 25",
        [INVOICE_TYPE[docType]],
      );
      return rows;
    }
    if (docType === "PAYSLIP") {
      const { rows } = await client.query(
        "SELECT i.payroll_run_item_id AS id, COALESCE(e.full_name, LEFT(i.payroll_run_item_id::text, 8)) || ' — ' || r.period_code AS label " +
          "FROM payroll_run_item i JOIN payroll_run r ON r.payroll_run_id = i.payroll_run_id LEFT JOIN employee e ON e.employee_id = i.employee_id " +
          "ORDER BY r.period_code DESC LIMIT 25",
      );
      return rows;
    }
    const s = SIMPLE[docType];
    if (s) {
      const lbl = s.label ? `COALESCE(${s.label}, LEFT(${s.pk}::text, 8))` : `LEFT(${s.pk}::text, 8)`;
      const { rows } = await client.query(`SELECT ${s.pk} AS id, ${lbl} AS label FROM ${s.table} ORDER BY created_at DESC LIMIT 25`);
      return rows;
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * The transit order's print payload.
 *
 * ITS OWN FUNCTION, unlike the one-liners above, because it is the only
 * document here whose facts come from THREE places and whose correctness
 * depends on picking the right one:
 *
 *   · the order itself — the decisions (regime, insurance, surveyor, value)
 *   · its lines — the cargo
 *   · the shipment-details projection — client, vessel, B/L, ports, dates
 *
 * THE SNAPSHOT COMES FIRST, AND THAT IS THE WHOLE POINT. Once the order has
 * been issued, `shipment_details_snapshot` (0661) holds the facts as they stood
 * when the client was asked to sign. Reprinting from the live dossier is the
 * legacy defect: `get_file.php` re-read the file every time, so a reprint after
 * a vessel change silently showed different facts than the stamped copy in the
 * client's file. The live projection is used only for a DRAFT, which has no
 * snapshot because it has not been shown to anyone yet.
 *
 * Facets are read BY ROLE, never by field key, so this works on a sea file, an
 * air file and a service type nobody has invented yet — the same reason
 * shipment_details.rules exists.
 */
const REGIME_CODES = ["IM4", "IM7", "IM8", "EX1", "EX2"];
const TO_STATUS_LABEL = {
  DRAFT: "Brouillon / Draft", ISSUED: "Émis / Issued", SIGNED: "Signé / Signed",
  LODGED: "Déclaré / Lodged", CANCELLED: "Annulé / Cancelled",
};
const fmtMoney = (n, ccy) =>
  `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${ccy || "XAF"}`;

/**
 * Delivery-note projection.
 *
 * The containers come from `delivery_note_container` — the note's own snapshot
 * — and NOT from the file's live `dossier_container_unit` rows. That is the
 * whole point of snapshotting them at pick time: a note signed in March must
 * reprint in September showing the boxes that were actually handed over, even
 * if the file has since been corrected.
 */
async function deliveryNoteData(client, recordId) {
  const { rows } = await client.query(
    `SELECT dn.*, d.ref AS dossier_ref, cm.name AS client_name, au.full_name AS issued_by_name
       FROM delivery_note dn
       LEFT JOIN dossier d ON d.dossier_id = dn.dossier_id
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
       LEFT JOIN app_user au ON au.user_id = dn.issued_by
      WHERE dn.delivery_note_id = $1`,
    [recordId],
  );
  const dn = rows[0];
  if (!dn) return null;

  const [lr, cr] = await Promise.all([
    client.query(
      "SELECT label, qty FROM delivery_note_line WHERE delivery_note_id = $1 ORDER BY delivery_note_line_id",
      [recordId],
    ),
    client.query(
      `SELECT container_no, seal_no, gross_weight_kg, dossier_container_line_id,
              container_type_code, qty
         FROM delivery_note_container WHERE delivery_note_id = $1 ORDER BY seq, created_at`,
      [recordId],
    ),
  ]);

  return {
    entity_id: dn.entity_id || null,
    data: {
      number: dn.doc_number || String(dn.delivery_note_id).slice(0, 8),
      date: dn.created_at,
      delivery_date: dn.delivery_date,
      dossier_ref: dn.dossier_ref || null,
      status: dn.status,
      party: {
        name: dn.consignee || dn.client_name || "—",
        // The address is the point of the document; city/zone alone is routing.
        lines: [dn.address, dn.city_zone, dn.contact_person, dn.phone].filter(Boolean),
      },
      lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty) })),
      // 10708 — a container row is either a per-box unit (number + seal) or a
      // GROUPED line ("3 × 40HC"): the note prints whichever the file stated.
      containers: cr.rows.map((c) => ({
        container_no: c.container_no,
        seal_no: c.seal_no,
        container_type_code: c.container_type_code,
        qty: Number(c.qty) || 1,
      })),
      reservations: dn.reservations || null,
      received_by_name: dn.received_by_name || null,
      received_at: dn.received_at || null,
      issued_by_name: dn.issued_by_name || null,
      currency: null,
    },
  };
}

async function transitOrderData(client, recordId) {
  const { rows } = await client.query(
    `SELECT t.*, d.ref AS dossier_ref, cm.name AS client_name
       FROM transit_order t
       LEFT JOIN dossier d ON d.dossier_id = t.dossier_id
       LEFT JOIN client_master cm ON cm.client_id = d.client_id
      WHERE t.transit_order_id = $1`,
    [recordId],
  );
  const to = rows[0];
  if (!to) return null;

  const lr = await client.query(
    "SELECT * FROM transit_order_line WHERE transit_order_id = $1 ORDER BY line_no NULLS LAST, transit_order_line_id",
    [recordId],
  );

  // Snapshot for an issued order; live only for a draft that has none.
  let details = to.shipment_details_snapshot || null;
  if (!details && to.dossier_id) {
    try {
      const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");
      details = await shipmentDetails.forDossier(client, to.dossier_id);
    } catch (err) {
      // A draft whose service type has lost its field set must still PRINT —
      // the shipment boxes read "—" and the operator sees the decisions, which
      // is strictly better than a 500 on the one screen they are trying to use
      // to fix the file. Logged rather than swallowed: it is a real data
      // problem on that dossier, just not this document's to raise.
      logger.warn({ err, transit_order_id: recordId }, "[documents] transit order printed without shipment details");
    }
  }
  const facet = (role) => {
    const f = details && details.facets ? details.facets[role] : null;
    return (f && f.value) || null;
  };

  const declaredCcy = to.declared_currency || "XAF";
  const fx = Number(to.declared_fx_to_xaf || 1) || 1;
  const declared = to.declared_value === null || to.declared_value === undefined ? null : Number(to.declared_value);

  const ticked = new Set(
    (Array.isArray(to.submitted_docs) ? to.submitted_docs : []).map((d) => String(d && d.code ? d.code : d).toUpperCase()),
  );
  const rules = require("../../operations/transit_order/transit_order.rules");

  return {
    entity_id: to.entity_id || null,
    data: {
      number: to.ot_number || String(to.transit_order_id).slice(0, 8),
      date: to.issued_at || to.created_at,
      status_label: TO_STATUS_LABEL[to.status] || to.status,
      direction: to.service_direction || "",

      client: to.client_name || "—",
      dossier_ref: to.dossier_ref || "—",
      conveyance: facet("CONVEYANCE"),
      transport_ref: facet("TRANSPORT_REF"),
      origin: facet("ORIGIN"),
      destination: facet("DESTINATION"),
      arrival_date: facet("ARRIVAL_DATE"),
      // The order's own departure date is the one the client agreed to; the
      // file's is only a fallback for an order raised before it was set.
      departure_date: to.departure_date || facet("DEPARTURE_DATE"),
      place_of_delivery: facet("FINAL_DELIVERY") || facet("DESTINATION"),

      lines: lr.rows.map((l) => ({
        marks: l.marks || "",
        packages: String(Number(l.packages || 0)),
        label: l.label,
        weight: l.weight || "",
        value: l.value_amount === null || l.value_amount === undefined ? "" : fmtMoney(l.value_amount, declaredCcy),
      })),

      declared_value_text: declared === null ? null : fmtMoney(declared, declaredCcy),
      // Only shown when it says something the line above does not.
      declared_value_xaf_text: declared === null || declaredCcy === "XAF" ? null : fmtMoney(declared * fx, "XAF"),

      regimes: REGIME_CODES.map((code) => ({ code, on: to.customs_regime === code })),
      customs_regime_other: to.customs_regime_other || null,

      insurance_type: to.insurance_type || "CLIENT",
      surveyor_party: to.surveyor_party || "CLIENT",

      documents: rules.SUBMITTED_DOC_TYPES.map((d) => ({
        code: d.code,
        label: `${d.label_fr} / ${d.label_en}`,
        on: ticked.has(d.code),
      })),

      instructions: to.instructions || null,
      declaration_ref: to.declaration_ref || null,
      lodged_date: to.lodged_at || null,
      issued_date: to.issued_at || null,
      signed_date: to.signed_at || null,
      signed_by_name: to.signed_by_name || null,
      currency: declaredCcy,
    },
  };
}

async function loadRecord(client, docType, recordId) {
  if (INVOICE_TYPE[docType]) {
    const { rows } = await client.query(
      "SELECT i.*, cm.name AS client_name, cm.niu AS client_niu, cm.rccm AS client_rccm " +
        "FROM invoice i LEFT JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
      [recordId],
    );
    const i = rows[0];
    if (!i) return null;
    const lr = await client.query("SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY line_no", [recordId]);
    return {
      entity_id: i.entity_id,
      data: {
        number: i.doc_number || String(i.invoice_id).slice(0, 8), date: i.issued_on, due: i.payment_due_on, status: i.status,
        original_ref: docType === "CREDIT_NOTE" ? null : undefined,
        party: { name: i.client_name || "—", lines: clientLines(i) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: l.is_disbursement ? null : 19.25, amount: Number(l.line_ht) })),
        totals: { service_ht: Number(i.service_ht), disbursement_total: Number(i.disbursement_total), vat_total: Number(i.vat_total), total_ttc: Number(i.total_ttc) },
        currency: i.currency,
      },
    };
  }

  if (docType === "QUOTATION") {
    const { rows } = await client.query(
      "SELECT q.*, cm.name AS client_name, cm.niu AS client_niu, cm.rccm AS client_rccm FROM quotation q LEFT JOIN client_master cm ON cm.client_id = q.client_id WHERE q.quotation_id = $1",
      [recordId],
    );
    const q = rows[0];
    if (!q) return null;
    const lr = await client.query("SELECT * FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [recordId]);
    return {
      entity_id: q.entity_id,
      data: {
        number: q.doc_number || String(q.quotation_id).slice(0, 8), date: q.created_at, valid_until: q.valid_until,
        party: { name: q.client_name || "—", lines: clientLines(q) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: 19.25, amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: Number(q.total_ht), vat_total: Number(q.total_ttc) - Number(q.total_ht), total_ttc: Number(q.total_ttc) },
        currency: q.currency,
      },
    };
  }

  if (docType === "PAYMENT_RECEIPT") {
    const { rows } = await client.query("SELECT r.*, cm.name AS client_name FROM payment_receipt r LEFT JOIN client_master cm ON cm.client_id = r.client_id WHERE r.receipt_id = $1", [recordId]);
    const r = rows[0];
    if (!r) return null;
    // What the receipt pays: allocations onto invoices.
    const al = await client.query(
      "SELECT a.amount, i.doc_number, i.invoice_id FROM payment_allocation a LEFT JOIN invoice i ON i.invoice_id = a.invoice_id WHERE a.receipt_id = $1 ORDER BY a.allocation_id",
      [recordId],
    );
    const allocations = al.rows.map((a) => ({ label: a.doc_number || (a.invoice_id ? `Facture ${String(a.invoice_id).slice(0, 8)}` : "Imputation"), amount: Number(a.amount) }));
    return {
      entity_id: null,
      data: {
        number: String(r.receipt_id).slice(0, 8), date: r.received_on || r.created_at, method: RECEIPT_METHOD[r.method] || r.method,
        amount: Number(r.amount), party: { name: r.client_name || "—", lines: [] },
        allocations, invoice_ref: allocations.map((a) => a.label).join(", ") || null,
        lines: allocations.length ? allocations.map((a) => ({ label: a.label, amount: a.amount })) : undefined,
        currency: null,
      },
    };
  }

  if (docType === "PROFORMA_ADVANCE") {
    const { rows } = await client.query("SELECT a.*, cm.name AS client_name FROM advance a LEFT JOIN client_master cm ON cm.client_id = a.client_id WHERE a.advance_id = $1", [recordId]);
    const a = rows[0];
    if (!a) return null;
    const amount = Number(a.amount);
    const applied = Number(a.applied_amount || 0);
    return {
      entity_id: null,
      data: {
        number: String(a.advance_id).slice(0, 8), date: a.received_on || a.created_at,
        party: { name: a.client_name || "—", lines: [] },
        lines: [{ label: "Acompte / Advance payment", qty: 1, unit: amount, amount }],
        totals: { service_ht: amount, vat_total: 0, total_ttc: amount },
        applied, currency: null,
      },
    };
  }

  if (docType === "PROPOSAL") {
    const { rows } = await client.query("SELECT p.*, cm.name AS client_name FROM proposal p LEFT JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1", [recordId]);
    const p = rows[0];
    if (!p) return null;
    const nr = await client.query("SELECT section, body FROM proposal_narrative WHERE proposal_id = $1 ORDER BY sort_order", [recordId]);
    const lr = await client.query("SELECT label, qty, unit_price FROM proposal_line WHERE proposal_id = $1 ORDER BY proposal_line_id", [recordId]);
    const sections = nr.rows.map((n) => ({ title: humanize(n.section), body: n.body || "" }));
    const lines = lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) }));
    const ht = lines.reduce((s2, l) => s2 + l.amount, 0);
    return {
      entity_id: null,
      data: {
        number: p.doc_number || String(p.proposal_id).slice(0, 8), date: p.created_at, status: p.status, headline: p.title,
        party: { name: p.client_name || "—", lines: [] }, sections, lines,
        totals: ht ? { service_ht: ht, total_ttc: ht } : undefined, currency: null,
      },
    };
  }

  if (docType === "SUPPLIER_INVOICE") {
    const { rows } = await client.query(
      `SELECT si.*, sm.name AS supplier_name, sm.niu AS supplier_niu, sm.address AS supplier_address, sm.city AS supplier_city,
              po.doc_number AS po_doc_number,
              COALESCE(e_p.signatory_name, au_p.full_name) AS posted_by_name,
              e_p.job_title AS posted_by_title,
              c.decimals AS currency_decimals
         FROM supplier_invoice si
         LEFT JOIN supplier_master sm ON sm.supplier_id = si.supplier_id
         LEFT JOIN purchase_order po ON po.po_id = si.po_id
         LEFT JOIN journal_entry je ON je.entry_id = si.entry_id
         LEFT JOIN app_user au_p ON au_p.user_id = je.created_by
         LEFT JOIN employee e_p ON e_p.employee_id = au_p.employee_id
         LEFT JOIN currency c ON c.code = si.currency
        WHERE si.supplier_invoice_id = $1`,
      [recordId],
    );
    const si = rows[0];
    if (!si) return null;
    const lr = await client.query("SELECT * FROM supplier_invoice_line WHERE supplier_invoice_id = $1 ORDER BY supplier_invoice_line_id", [recordId]);
    const ttc = Number(si.amount_ttc || 0);
    return {
      entity_id: si.entity_id,
      data: {
        number: si.doc_number || String(si.supplier_invoice_id).slice(0, 8), date: si.created_at, status: si.status, supplier_ref: si.supplier_ref,
        due: si.due_on, po_ref: si.po_doc_number,
        party: { name: si.supplier_name || "—", lines: [si.supplier_address, si.supplier_city, si.supplier_niu && `NIU ${si.supplier_niu}`].filter(Boolean) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: Number(si.amount_ht), vat_total: Number(si.vat_total), wht_total: Number(si.wht_total), total_ttc: ttc },
        amount_in_words: ttc,
        currency: si.currency || "XAF",
        posted_by_name: si.posted_by_name || null,
        posted_by_title: si.posted_by_title || null,
        currency_decimals: si.currency_decimals !== null && si.currency_decimals !== undefined ? Number(si.currency_decimals) : undefined,
      },
    };
  }

  if (docType === "PURCHASE_ORDER") {
    const { rows } = await client.query(
      `SELECT po.*,
              COALESCE(po.supplier_name, sm.name) AS supplier_name,
              COALESCE(po.supplier_niu, sm.niu) AS supplier_niu,
              COALESCE(po.supplier_address, sm.address) AS supplier_address,
              COALESCE(po.supplier_city, sm.city) AS supplier_city,
              COALESCE(e_i.signatory_name, au_i.full_name) AS issuer_name,
              e_i.job_title AS issuer_title,
              COALESCE(e_a.signatory_name, au_a.full_name) AS approver_name,
              e_a.job_title AS approver_title,
              c.decimals AS currency_decimals
         FROM purchase_order po
         LEFT JOIN supplier_master sm ON sm.supplier_id = po.supplier_id
         LEFT JOIN app_user au_i ON au_i.user_id = po.issuer_id
         LEFT JOIN employee e_i ON e_i.employee_id = au_i.employee_id
         LEFT JOIN app_user au_a ON au_a.user_id = po.approver_id
         LEFT JOIN employee e_a ON e_a.employee_id = au_a.employee_id
         LEFT JOIN currency c ON c.code = po.currency
        WHERE po.po_id = $1`,
      [recordId],
    );
    const po = rows[0];
    if (!po) return null;
    // Per-line VAT resolved through the line's tax code, so the printed column
    // and the printed totals agree with what the PO was priced at (10720).
    const lr = await client.query(
      `SELECT poi.*, tc.rate_percent AS vat_rate
         FROM purchase_order_item poi
         LEFT JOIN tax_code tc ON tc.tax_code_id = poi.tax_code_id
        WHERE poi.po_id = $1 ORDER BY poi.po_item_id`,
      [recordId],
    );
    const ht = lr.rows.reduce((s2, l) => s2 + Number(l.qty) * Number(l.unit_price), 0);
    const ttc = Number(po.total_ttc) || ht;
    const vat = Number(po.total_vat) || Math.max(0, ttc - ht);
    const withholding = Math.round((ht * Number(po.air_rate || 0)) / 100 * 100) / 100;
    const net = po.net_payable !== null && po.net_payable !== undefined ? Number(po.net_payable) : Math.round((ttc - withholding - Number(po.adv_paid || 0)) * 100) / 100;
    return {
      entity_id: po.entity_id || null,
      data: {
        number: po.doc_number || String(po.po_id).slice(0, 8), date: po.created_at, status: po.status,
        currency: po.currency || "XAF",
        delivery_on: po.delivery_on, due_on: po.due_on, delivery_location: po.delivery_location,
        payment_means: po.payment_means, pay_days: Number(po.pay_days || 0),
        air_rate: Number(po.air_rate || 0), adv_paid: Number(po.adv_paid || 0), remarks: po.remarks,
        party: { name: po.supplier_name || "—", lines: [po.supplier_address, po.supplier_city, po.supplier_niu && `NIU ${po.supplier_niu}`].filter(Boolean) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: l.vat_rate !== null && l.vat_rate !== undefined ? String(l.vat_rate) : "", amount: Number(l.qty) * Number(l.unit_price) })),
        totals: { service_ht: ht, vat_total: vat, total_ttc: ttc, withholding, net_payable: net },
        amount_in_words: net,
        issuer_name: po.issuer_name || null,
        issuer_title: po.issuer_title || null,
        approver_name: po.approver_name || null,
        approver_title: po.approver_title || null,
        currency_decimals: po.currency_decimals !== null && po.currency_decimals !== undefined ? Number(po.currency_decimals) : undefined,
      },
    };
  }

  if (docType === "PURCHASE_REQUEST") {
    const { rows } = await client.query(
      `SELECT pr.*, u.full_name AS requester,
              COALESCE(e.signatory_name, u.full_name) AS requester_name,
              e.job_title AS requester_title
         FROM purchase_request pr
         LEFT JOIN app_user u ON u.user_id = pr.requested_by
         LEFT JOIN employee e ON e.employee_id = u.employee_id
        WHERE pr.pr_id = $1`,
      [recordId],
    );
    const pr = rows[0];
    if (!pr) return null;
    const lr = await client.query("SELECT label, qty, unit_price FROM purchase_request_line WHERE pr_id = $1 ORDER BY purchase_request_line_id", [recordId]);
    const lines = lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), amount: Number(l.qty) * Number(l.unit_price) }));
    const total = lines.reduce((s2, l) => s2 + l.amount, 0);
    return {
      entity_id: null,
      data: {
        number: pr.doc_number || String(pr.pr_id).slice(0, 8), date: pr.created_at, status: pr.status, department: pr.department,
        party: { name: pr.requester || pr.department || "—", lines: [pr.department].filter(Boolean) },
        reason: pr.justification || undefined, lines, totals: { total_ttc: total }, currency: null,
        requester_name: pr.requester_name || null,
        requester_title: pr.requester_title || null,
      },
    };
  }

  if (docType === "CASH_REQUEST") {
    const { rows } = await client.query(
      `SELECT cr.*, u.full_name AS requester_name, u.email AS requester_email, d.ref AS dossier_ref,
              COALESCE(e_v.signatory_name, au_v.full_name) AS validated_by_name,
              e_v.job_title AS validated_by_title,
              COALESCE(e_a.signatory_name, au_a.full_name) AS approved_by_name,
              e_a.job_title AS approved_by_title
         FROM cash_request cr
         LEFT JOIN app_user u ON u.user_id = cr.requested_by
         LEFT JOIN dossier d ON d.dossier_id = cr.dossier_id
         LEFT JOIN app_user au_v ON au_v.user_id = cr.validated_by
         LEFT JOIN employee e_v ON e_v.employee_id = au_v.employee_id
         LEFT JOIN app_user au_a ON au_a.user_id = cr.approver_id
         LEFT JOIN employee e_a ON e_a.employee_id = au_a.employee_id
        WHERE cr.cash_request_id = $1`,
      [recordId],
    );
    const cr = rows[0];
    if (!cr) return null;
    const lr = await client.query("SELECT label, budget_amount, vat_percent FROM cash_request_line WHERE cash_request_id = $1 ORDER BY cash_request_line_id", [recordId]);
    const purpose = lr.rows.map((l) => l.label).filter(Boolean).join(", ");
    // §3.5 — the voucher footer: Subtotal / VAT / TOTAL PAYABLE, same rule the
    // service applies (lazy require: see the transit-order branch note).
    const { computeTotals } = require("../../costing/cash_request/cash_request.rules");
    const totals = computeTotals(lr.rows);
    return {
      entity_id: null,
      data: {
        number: cr.doc_number || String(cr.cash_request_id).slice(0, 8), date: cr.created_at, status: cr.status,
        amount: Number(cr.amount), purpose, dossier_ref: cr.dossier_ref,
        beneficiary: cr.beneficiary, category: cr.category, cost_center: cr.cost_center,
        overhead_justification: cr.overhead_justification, remarks: cr.remarks,
        method: cr.disbursement_method || null,
        method_details: cr.disbursement_details || {},
        lines: lr.rows.map((l) => ({ label: l.label, qty: 1, unit: Number(l.budget_amount), tax: l.vat_percent !== null && l.vat_percent !== undefined ? Number(l.vat_percent) : null, amount: Number(l.budget_amount) })),
        totals,
        party: { name: cr.requester_name || "—", lines: [cr.requester_email].filter(Boolean) },
        validated_by_name: cr.validated_by_name || null,
        validated_by_title: cr.validated_by_title || null,
        approved_by_name: cr.approved_by_name || null,
        approved_by_title: cr.approved_by_title || null,
        received_by_name: cr.beneficiary || null,
        currency: null,
      },
    };
  }

  /* §3.3 — the costing worksheet, footer Subtotal (HT) / VAT / Total Estimate.
   * Totals are computed the same way costing.service.get computes them
   * (per-line VAT from the line's own tax code; no margin — §2.2). */
  if (docType === "COSTING") {
    const { rows } = await client.query(
      `SELECT c.*, d.ref AS dossier_ref, v.full_name AS validator_name
         FROM costing c
         LEFT JOIN dossier d ON d.dossier_id = c.dossier_id
         LEFT JOIN app_user v ON v.user_id = c.validator_id
        WHERE c.costing_id = $1`,
      [recordId],
    );
    const c = rows[0];
    if (!c) return null;
    const lr = await client.query(
      `SELECT cl.label, cl.qty, cl.unit_cost, cl.is_disbursement, tc.rate_percent AS tax_rate_percent
         FROM costing_line cl LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id
        WHERE cl.costing_id = $1 ORDER BY cl.costing_line_id`,
      [recordId],
    );
    // Lazy require (pattern of the transit-order branch above): pulling the
    // costing rules at module load would force every test that mocks this
    // service's collaborators to know about them.
    const { computeCosting } = require("../../costing/costing/costing.rules");
    const totals = computeCosting(lr.rows);
    return {
      entity_id: null,
      data: {
        number: c.doc_number || String(c.costing_id).slice(0, 8), date: c.created_at, status: c.status,
        dossier_ref: c.dossier_ref, validator: c.validator_name, remarks: c.remarks,
        exchange_rate: Number(c.exchange_rate_to_xaf),
        lines: lr.rows.map((l) => ({
          label: l.label, qty: Number(l.qty), unit: Number(l.unit_cost),
          tax: l.is_disbursement ? null : (l.tax_rate_percent !== null && l.tax_rate_percent !== undefined ? Number(l.tax_rate_percent) : null),
          amount: Number(l.qty) * Number(l.unit_cost),
        })),
        totals: { total_ht: totals.total_ht, vat_total: totals.vat_total, total_ttc: totals.total_ttc, disbursement_total: totals.disbursement_total },
        currency: c.currency,
      },
    };
  }

  if (docType === "REGIE_ADVANCE") {
    const { rows } = await client.query("SELECT * FROM regie_advance WHERE regie_advance_id = $1", [recordId]);
    const ra = rows[0];
    if (!ra) return null;
    return { entity_id: null, data: { number: String(ra.regie_advance_id).slice(0, 8), date: ra.issued_on || ra.created_at, status: ra.state, amount: Number(ra.amount), party: { name: "—", lines: [] }, currency: null } };
  }

  if (docType === "WORK_ORDER") {
    const { rows } = await client.query(
      "SELECT wo.*, v.registration FROM work_order wo LEFT JOIN vehicle v ON v.vehicle_id = wo.vehicle_id WHERE wo.work_order_id = $1",
      [recordId],
    );
    const wo = rows[0];
    if (!wo) return null;
    const lr = await client.query("SELECT * FROM work_order_part WHERE work_order_id = $1 ORDER BY work_order_part_id", [recordId]);
    const parts = lr.rows.map((p) => ({ label: p.label, qty: Number(p.qty), unit_cost: Number(p.unit_cost) }));
    const cost = wo.cost !== null && wo.cost !== undefined ? Number(wo.cost) : parts.reduce((s2, p) => s2 + p.qty * p.unit_cost, 0);
    return { entity_id: null, data: { number: String(wo.work_order_id).slice(0, 8), date: wo.opened_on || wo.created_at, status: wo.status, vehicle: wo.registration || "—", description: wo.description, parts, cost, currency: null } };
  }

  if (docType === "SOP_DOCUMENT") {
    const { rows } = await client.query("SELECT * FROM sop_document WHERE sop_document_id = $1", [recordId]);
    const d = rows[0];
    if (!d) return null;
    /*
     * `sections` is cut from `body_md` at its `##` headings by the SAME helper
     * the contract renderer uses, and for the same reason: what a person edited
     * on screen must be what the printed document is divided into. An SOP with
     * no body renders as a letterhead and a sign-off block with nothing between
     * them — which is exactly the defect 0700 found in contracts, so the screen
     * refuses to render a PDF for an SOP that has no text rather than producing
     * a convincing empty procedure.
     */
    return {
      entity_id: null,
      data: {
        number: String(d.sop_document_id).slice(0, 8),
        title: d.title,
        scope: d.scope,
        department: d.department,
        version: d.version_no,
        effective_on: d.effective_on,
        review_on: d.review_on,
        sections: contractArticles(d.body_md),
        currency: null,
      },
    };
  }

  if (docType === "EMPLOYMENT_CONTRACT") {
    const { rows } = await client.query(
      `SELECT c.*, e.full_name, e.job_title AS employee_job_title, coalesce(c.entity_id, e.entity_id) AS entity_id
         FROM hr_contract c LEFT JOIN employee e ON e.employee_id = c.employee_id
        WHERE c.hr_contract_id = $1`,
      [recordId],
    );
    const c = rows[0];
    if (!c) return null;
    /*
     * `articles` used to be a hard-coded `[]`.
     *
     * The template renders one "Article N — <title>" section per entry, so an
     * empty list produced a contract with a letterhead, the two parties, a
     * signature block — AND NO CLAUSES. Every employment contract this system
     * has ever generated was a blank form. Nobody caught it because the PDF
     * looks entirely correct until you read it.
     *
     * `body_md` (0700) is the agreed text, drafted by the model or the
     * template and then edited by a human. `contractArticles` cuts it at its
     * `##` headings, which is exactly the shape the renderer wants.
     */
    return {
      entity_id: c.entity_id,
      data: {
        number: String(c.hr_contract_id).slice(0, 8),
        status: c.status,
        kind: c.kind,
        effective_on: c.effective_on,
        end_on: c.end_on,
        employee_name: c.full_name || "—",
        job_title: c.job_title || c.employee_job_title,
        party: { name: c.full_name || "—", lines: [c.job_title || c.employee_job_title].filter(Boolean) },
        articles: contractArticles(c.body_md),
        // The terms, so a template that wants them beside the clauses has them
        // rather than having to parse the prose back out.
        gross_salary: c.gross_salary === null || c.gross_salary === undefined ? null : Number(c.gross_salary),
        probation_months: c.probation_months,
        probation_ends_on: c.probation_ends_on,
        notice_days: c.notice_days,
        working_hours: c.working_hours,
        place_of_work: c.place_of_work,
        signed_on: c.signed_on,
        signed_vault_id: c.pdf_vault_id || null,
        currency: c.salary_currency || "XAF",
      },
    };
  }

  if (docType === "DELIVERY_NOTE") return deliveryNoteData(client, recordId);

  if (docType === "TRANSIT_ORDER") return transitOrderData(client, recordId);

  if (docType === "GRN") {
    const { rows } = await client.query("SELECT * FROM grn_inbound WHERE grn_inbound_id = $1", [recordId]);
    const g = rows[0];
    if (!g) return null;
    const lr = await client.query("SELECT item, ordered, received, condition FROM grn_line WHERE grn_inbound_id = $1 ORDER BY grn_line_id", [recordId]);
    return { entity_id: null, data: { number: String(g.grn_inbound_id).slice(0, 8), date: g.created_at, po_ref: g.dossier_id ? String(g.dossier_id).slice(0, 8) : null, qa_status: g.qa_status, supplier: "—", lines: lr.rows.map((l) => ({ item: l.item, ordered: String(Number(l.ordered)), received: String(Number(l.received)), condition: l.condition || "" })), currency: null } };
  }

  if (docType === "GOODS_RECEIVED") {
    const { rows } = await client.query(
      `SELECT grn.*, po.doc_number AS po_doc_number, po.currency AS po_currency,
              sm.name AS supplier_name, sm.address AS supplier_address, sm.city AS supplier_city, sm.niu AS supplier_niu,
              COALESCE(e_r.signatory_name, au_r.full_name) AS received_by_name,
              e_r.job_title AS received_by_title
         FROM goods_received_note grn
         LEFT JOIN purchase_order po ON po.po_id = grn.po_id
         LEFT JOIN supplier_master sm ON sm.supplier_id = po.supplier_id
         LEFT JOIN app_user au_r ON au_r.user_id = grn.received_by
         LEFT JOIN employee e_r ON e_r.employee_id = au_r.employee_id
        WHERE grn.grn_id = $1`,
      [recordId],
    );
    const g = rows[0];
    if (!g) return null;
    const lr = await client.query("SELECT * FROM goods_received_line WHERE grn_id = $1 ORDER BY grn_line_id", [recordId]);
    return {
      entity_id: g.entity_id || null,
      data: {
        number: g.doc_number || String(g.grn_id).slice(0, 8),
        date: g.received_on || g.created_at,
        po_ref: g.po_doc_number || (g.po_id ? String(g.po_id).slice(0, 8) : null),
        supplier_invoice_ref: g.supplier_invoice_ref,
        supplier: g.supplier_name || "—",
        supplier_lines: [g.supplier_address, g.supplier_city, g.supplier_niu && `NIU ${g.supplier_niu}`].filter(Boolean),
        note: g.note,
        received_by_name: g.received_by_name || null,
        received_by_title: g.received_by_title || null,
        lines: lr.rows.map((l) => ({ item: l.label, ordered: String(Number(l.ordered)), received: String(Number(l.received)), condition: l.condition || "" })),
        currency: g.po_currency || "XAF",
      },
    };
  }

  if (docType === "CYCLE_COUNT_SHEET") {
    const { rows } = await client.query("SELECT * FROM cycle_count WHERE cycle_count_id = $1", [recordId]);
    const cc = rows[0];
    if (!cc) return null;
    const raw = cc.discrepancy;
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.lines) ? raw.lines : []);
    // Discrepancy lines carry inventory_item_id; resolve to a human sku/description.
    const ids = arr.map((l) => l.inventory_item_id).filter(Boolean);
    const nameById = {};
    if (ids.length) {
      const im = await client.query("SELECT inventory_item_id, sku, description FROM inventory_item WHERE inventory_item_id = ANY($1)", [ids]);
      for (const r of im.rows) nameById[r.inventory_item_id] = r.description || r.sku || String(r.inventory_item_id).slice(0, 8);
    }
    const lines = arr.map((l) => ({
      item: l.item || l.label || nameById[l.inventory_item_id] || (l.inventory_item_id ? String(l.inventory_item_id).slice(0, 8) : "—"),
      expected: String(l.expected ?? ""), counted: String(l.counted ?? ""),
      variance: String(l.variance ?? (Number(l.counted || 0) - Number(l.expected || 0))),
    }));
    const locRow = cc.location_id ? await client.query("SELECT zone FROM warehouse_location WHERE location_id = $1", [cc.location_id]).then((x) => x.rows[0]).catch(() => null) : null;
    const location = (locRow && locRow.zone) || (cc.location_id ? String(cc.location_id).slice(0, 8) : "—");
    return { entity_id: null, data: { number: String(cc.cycle_count_id).slice(0, 8), date: cc.created_at, location, lines, currency: null } };
  }

  if (docType === "TRIP_SHEET") {
    const { rows } = await client.query(
      "SELECT d.*, v.registration, e.full_name AS driver_name FROM fleet_dispatch d LEFT JOIN vehicle v ON v.vehicle_id = d.vehicle_id LEFT JOIN employee e ON e.employee_id = d.driver_employee_id WHERE d.fleet_dispatch_id = $1",
      [recordId],
    );
    const d = rows[0];
    if (!d) return null;
    const dist = d.odometer_out !== null && d.odometer_in !== null && d.odometer_out !== undefined && d.odometer_in !== undefined ? Number(d.odometer_in) - Number(d.odometer_out) : null;
    return { entity_id: null, data: { number: String(d.fleet_dispatch_id).slice(0, 8), date: d.check_out_at || d.created_at, vehicle: d.registration || "—", driver: d.driver_name || "—", origin: "", destination: "", odometer_out: d.odometer_out, odometer_in: d.odometer_in, distance: dist, currency: null } };
  }

  if (docType === "PAYSLIP") {
    const { rows } = await client.query(
      "SELECT i.*, r.period_code, r.entity_id, e.full_name, e.job_title, e.cnps_number FROM payroll_run_item i " +
        "JOIN payroll_run r ON r.payroll_run_id = i.payroll_run_id LEFT JOIN employee e ON e.employee_id = i.employee_id WHERE i.payroll_run_item_id = $1",
      [recordId],
    );
    const it = rows[0];
    if (!it) return null;
    const b = it.breakdown || {};
    const ded = b.employee || {};
    const earnings = [{ label: "Salaire de base", amount: Number(b.base || 0) }].concat(
      (b.earning_lines || []).map((l) => ({ label: l.label || "Prime", amount: Number(l.amount || 0) })),
    );
    const deductions = [
      { label: "CNPS pension", amount: Number(ded.cnps_pension || 0) },
      { label: "IRPP", amount: Number(ded.irpp || 0) },
      { label: "CAC", amount: Number(ded.cac || 0) },
      { label: "CFC", amount: Number(ded.cfc || 0) },
    ].filter((d) => d.amount);
    const totalDed = deductions.reduce((s2, d) => s2 + d.amount, 0);
    return {
      entity_id: it.entity_id,
      data: {
        number: String(it.payroll_run_item_id).slice(0, 8), period: it.period_code, staff_no: null,
        employee_name: it.full_name || "—", job_title: it.job_title, cnps_number: it.cnps_number,
        earnings, deductions, gross: Number(it.gross), total_deductions: totalDed, net: Number(it.net_pay), currency: null,
      },
    };
  }

  return null;
}

// Each sendable docType → the SQL that yields its recipient email from the
// party master (client/supplier/employee) or a CRM lead. $1 is the record id.
const RECIPIENT_SQL = {
  FINAL_INVOICE: "SELECT cm.email FROM invoice i JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
  CREDIT_NOTE: "SELECT cm.email FROM invoice i JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
  QUOTATION: "SELECT cm.email FROM quotation q JOIN client_master cm ON cm.client_id = q.client_id WHERE q.quotation_id = $1",
  PAYMENT_RECEIPT: "SELECT cm.email FROM payment_receipt r JOIN client_master cm ON cm.client_id = r.client_id WHERE r.receipt_id = $1",
  PROFORMA_ADVANCE: "SELECT cm.email FROM advance a JOIN client_master cm ON cm.client_id = a.client_id WHERE a.advance_id = $1",
  PROPOSAL: "SELECT COALESCE(l.email, cm.email) AS email FROM proposal p LEFT JOIN lead l ON l.lead_id = p.lead_id LEFT JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1",
  PURCHASE_ORDER: "SELECT sm.email FROM purchase_order po JOIN supplier_master sm ON sm.supplier_id = po.supplier_id WHERE po.po_id = $1",
  SUPPLIER_INVOICE: "SELECT sm.email FROM supplier_invoice si JOIN supplier_master sm ON sm.supplier_id = si.supplier_id WHERE si.supplier_invoice_id = $1",
  EMPLOYMENT_CONTRACT: "SELECT e.email FROM hr_contract c JOIN employee e ON e.employee_id = c.employee_id WHERE c.hr_contract_id = $1",
  PAYSLIP: "SELECT e.email FROM payroll_run_item i JOIN employee e ON e.employee_id = i.employee_id WHERE i.payroll_run_item_id = $1",
  // Consignee/carrier aren't emailable masters, so resolve to the dossier's
  // client (the served party); the Send prompt stays editable for a different one.
  DELIVERY_NOTE: "SELECT cm.email FROM delivery_note dn JOIN dossier d ON d.dossier_id = dn.dossier_id JOIN client_master cm ON cm.client_id = d.client_id WHERE dn.delivery_note_id = $1",
  TRANSIT_ORDER: "SELECT cm.email FROM transit_order t JOIN dossier d ON d.dossier_id = t.dossier_id JOIN client_master cm ON cm.client_id = d.client_id WHERE t.transit_order_id = $1",
};

/** Best-effort recipient email for a record, resolved from the party master
 *  (client/supplier/employee) or a CRM lead. Returns null when none is stored →
 *  the caller falls back to a manually-supplied address. */
async function resolveRecipient(client, docType, recordId) {
  if (!recordId || !RECIPIENT_SQL[docType]) return null;
  try {
    const { rows } = await client.query(RECIPIENT_SQL[docType], [recordId]);
    return (rows[0] && rows[0].email) || null;
  } catch { /* @silent:parse — resolving a recipient is a convenience lookup over a
    per-doc-type SQL map; a missing table or a renamed column must degrade to
    "caller supplies `to`", never fail the send. The caller already handles null
    by requiring an explicit recipient. */ }
  return null;
}

/** Live preview → HTML (no PDF). Real record when recordId + a loader exist, else sample. */
async function preview(client, { docType, entityId, recordId, config }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  let data = tpl.sampleData;
  let ent = entityId;
  let real = false;
  if (recordId) {
    const rec = await loadRecord(client, docType, recordId);
    if (rec) { data = rec.data; ent = ent || rec.entity_id; real = true; }
  }
  const { cfg, entity } = await resolveCfg(client, docType, ent, config);
  return {
    html: tpl.build(data, cfg, entity, `praxis://verify/${docType.toLowerCase()}:preview`),
    sample: !real,
    data, // structured data for the native (app-themed) detail view
    title: tpl.title,
    entity: { legal_name: entity.legal_name, niu: entity.niu, rccm: entity.rccm },
    suggested_to: real ? await resolveRecipient(client, docType, recordId) : null,
    report: !!tpl.report,
  };
}

/** Render a real, immutable, vaulted PDF (SHA-256 + QR) for a record. */
async function generate(client, { docType, entityId, recordId, actor }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const rec = recordId ? await loadRecord(client, docType, recordId) : null;
  const data = rec ? rec.data : tpl.sampleData;
  const ent = entityId || (rec && rec.entity_id);
  const { cfg, entity } = await resolveCfg(client, docType, ent);
  const entityRef = `${docType.toLowerCase()}:${recordId || "adhoc"}`;
  const key = `documents/${docType}/${recordId || "adhoc"}-${Date.now()}.pdf`;
  // G2 — sandbox renders are watermarked TEST SANDBOX regardless of config.
  cfg.watermark = kit.watermarkFor(client, cfg.watermark);
  const html = tpl.build(data, cfg, entity, `praxis://verify/${entityRef}`);
  return pdf.renderAndStore(client, { html, key, entityRef, docType, actor });
}

/** Render a branded PDF from already-computed data (reports / tax filings, which
 *  are parameterized rather than record-based). Resolves the doc's config +
 *  entity, builds via the registry, and vaults the PDF. */
async function renderPdfFromData(client, { docType, data, entityId, actor }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const { cfg, entity } = await resolveCfg(client, docType, entityId);
  const stamp = Date.now();
  const entityRef = `${docType.toLowerCase()}:${stamp}`;
  const key = `documents/${docType}/${stamp}.pdf`;
  // G2 — sandbox renders are watermarked TEST SANDBOX regardless of config.
  cfg.watermark = kit.watermarkFor(client, cfg.watermark);
  const html = tpl.build(data, cfg, entity, `praxis://verify/${entityRef}`);
  return pdf.renderAndStore(client, { html, key, entityRef, docType, actor });
}

/** Send a document to a recipient: render it, attach the PDF (falling back to
 *  inline HTML if the render fails), then vault a PDF copy (best-effort) and
 *  audit. `to` is resolved from the record where possible (e.g. a proposal's
 *  lead) and otherwise supplied by the caller. */
async function send(client, { docType, entityId, recordId, to, subject, actor = {} }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  const recipient = to || (await resolveRecipient(client, docType, recordId));
  if (!recipient) throw new AppError("NO_RECIPIENT", "recipient email 'to' is required", 422);
  const { html } = await preview(client, { docType, entityId, recordId });
  const title = (tpl.title && (tpl.title.en || tpl.title.fr)) || docType;

  // Attach the rendered PDF so the recipient gets a real document, not just an
  // inline HTML body. Best-effort: if Puppeteer fails, still send inline.
  let attachments = null;
  try {
    const buffer = await pdf.renderHtml(html);
    if (buffer && buffer.length) attachments = [{ filename: `${docType.toLowerCase()}.pdf`, content: buffer, contentType: "application/pdf" }];
  } catch { /* @silent:storage — the PDF render needs headless Chrome, which is the
    one dependency that is routinely absent on a fresh deploy (see
    doc/PDF_RENDERING_SETUP.md). The email still goes, with the document inline;
    losing the attachment is strictly better than not sending it. */ }

  await emailSvc.send(client, {
    to: recipient, subject: subject || title, html, attachments, purpose: "NOTIFICATIONS", moduleKey: "MOD-70",
    // Record the source document on the send-log row (e.g. `invoice:<id>`).
    entityRef: entityId || recordId ? `${String(docType).toLowerCase()}:${entityId || recordId}` : null,
  });
  try { await generate(client, { docType, entityId, recordId, actor }); } catch { /* @silent:storage —
    the email has already been sent by this point. Filing a vault copy is
    bookkeeping; failing here would report the send as failed and invite somebody
    to send it twice. */ }
  await audit(client, { actorUserId: actor.user_id || null, action: "document.sent", moduleKey: "MOD-70", entityRef: `${docType.toLowerCase()}:${recordId || "adhoc"}`, after: { to: recipient, docType, attached: !!attachments } });
  return { sent: true, to: recipient, docType, attached: !!attachments };
}


/**
 * Split a contract body into the articles the template renders.
 *
 * Cuts on `##` headings — the shape both the AI drafter and the template
 * fallback produce (see hr_contract.draft). Text before the first heading is
 * kept as an untitled preamble rather than dropped: a human editing the body is
 * entitled to write a sentence at the top without it silently vanishing from
 * the PDF.
 */
function contractArticles(bodyMd) {
  if (!bodyMd || !String(bodyMd).trim()) return [];
  const out = [];
  let title = null;
  let buf = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (title || body) out.push({ title: title || "", body });
    buf = [];
  };
  for (const line of String(bodyMd).split(/\r?\n/)) {
    const h = /^\s*#{2,3}\s+(.*\S)\s*$/.exec(line);
    if (h) {
      flush();
      title = h[1];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.filter((a) => a.title || a.body);
}

module.exports = {
  // Exported for the test that pins it — see tests/unit/contract-draft.
  contractArticles, list, getConfig, setConfig, records, preview, generate, renderPdfFromData, send };
