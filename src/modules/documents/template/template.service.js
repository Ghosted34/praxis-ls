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

async function resolveEntity(client, entityId) {
  const q = entityId
    ? await client.query("SELECT * FROM corporate_entity WHERE entity_id = $1", [entityId])
    : await client.query("SELECT * FROM corporate_entity ORDER BY created_at LIMIT 1");
  const entity = q.rows[0] || {};
  let logo_url = null;
  try { if (entity.logo_light_ref) logo_url = storage.publicUrl(entity.logo_light_ref); } catch { logo_url = null; }
  return { entity, brand: { logo_url } };
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
    defaults: kit.defaults({ logo_url: entity.logo_light_ref ? storage.publicUrl(entity.logo_light_ref) : null }),
  };
}

async function setConfig(client, { docType, entityId, config, actor }) {
  if (!registry.get(docType)) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  await settings.put(client, { section: SECTION, key: keyOf(docType, entityId), value: config || {}, actor });
  return { ok: true, docType, entity_id: entityId || null };
}

/* ── record loading (real records for the preview picker / generate) ────────── */
const INVOICE_TYPE = { FINAL_INVOICE: "FINAL", PROFORMA_ADVANCE: "PROFORMA", CREDIT_NOTE: "CREDIT_NOTE" };
// docTypes with their own head table (label column for the picker).
const SIMPLE = {
  QUOTATION: { table: "quotation", pk: "quotation_id", label: "doc_number" },
  PAYMENT_RECEIPT: { table: "payment_receipt", pk: "receipt_id", label: null },
  PROPOSAL: { table: "proposal", pk: "proposal_id", label: "title" },
};
const clientLines = (r) => [r.client_niu && `NIU ${r.client_niu}`, r.client_rccm && `RCCM ${r.client_rccm}`].filter(Boolean);
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
        number: i.doc_number || String(i.invoice_id).slice(0, 8), date: i.issued_on, due: i.payment_due_on,
        original_ref: docType === "CREDIT_NOTE" ? null : undefined,
        party: { name: i.client_name || "—", lines: clientLines(i) },
        lines: lr.rows.map((l) => ({ label: l.label, qty: Number(l.qty), unit: Number(l.unit_price), tax: l.is_debours ? null : 19.25, amount: Number(l.line_ht) })),
        totals: { service_ht: Number(i.service_ht), debours_total: Number(i.debours_total), vat_total: Number(i.vat_total), total_ttc: Number(i.total_ttc) },
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
    return { entity_id: null, data: { number: String(r.receipt_id).slice(0, 8), date: r.received_on || r.created_at, method: RECEIPT_METHOD[r.method] || r.method, amount: Number(r.amount), party: { name: r.client_name || "—", lines: [] }, currency: "XAF" } };
  }

  if (docType === "PROPOSAL") {
    const { rows } = await client.query("SELECT p.*, cm.name AS client_name FROM proposal p LEFT JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1", [recordId]);
    const p = rows[0];
    if (!p) return null;
    return { entity_id: null, data: { number: String(p.proposal_id).slice(0, 8), date: p.created_at, headline: p.title, party: { name: p.client_name || "—", lines: [] }, sections: [], currency: "XAF" } };
  }

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
  return { html: tpl.build(data, cfg, entity, `praxis://verify/${docType.toLowerCase()}:preview`), sample: !real };
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
  const html = tpl.build(data, cfg, entity, `praxis://verify/${entityRef}`);
  return pdf.renderAndStore(client, { html, key, entityRef, docType, actor });
}

/** Send a document to a recipient: render it and email the rendered document
 *  inline (the mailer has no attachment channel), then vault a PDF copy
 *  (best-effort) and audit. `to` is required — client contact emails aren't
 *  stored on the master today, so the caller supplies/confirms the recipient. */
async function send(client, { docType, entityId, recordId, to, subject, actor = {} }) {
  const tpl = registry.get(docType);
  if (!tpl) throw new AppError("UNKNOWN_DOC", `No template '${docType}'`, 404);
  if (!to) throw new AppError("NO_RECIPIENT", "recipient email 'to' is required", 422);
  const { html } = await preview(client, { docType, entityId, recordId });
  const title = (tpl.title && (tpl.title.en || tpl.title.fr)) || docType;
  await emailSvc.send(client, { to, subject: subject || title, html, purpose: "NOTIFICATIONS", moduleKey: "MOD-70" });
  try { await generate(client, { docType, entityId, recordId, actor }); } catch { /* vault copy is best-effort */ }
  await audit(client, { actorUserId: actor.user_id || null, action: "document.sent", moduleKey: "MOD-70", entityRef: `${docType.toLowerCase()}:${recordId || "adhoc"}`, after: { to, docType } });
  return { sent: true, to, docType };
}

module.exports = { list, getConfig, setConfig, records, preview, generate, renderPdfFromData, send };
