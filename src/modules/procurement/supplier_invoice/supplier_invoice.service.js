/**
 * Supplier invoice (MOD-61, KB §8.5) — the finance end of procurement.
 * Lifecycle: createDraft → match (three-way PR/PO/GRN/invoice) → post
 * (Dr expense + input-VAT, Cr supplier net of WHT + Cr WHT payable) → capture.
 * Match tolerance is a tenant business rule (settings). All SQL is in the repo.
 */
"use strict";

const repo = require("./supplier_invoice.repo");
const events = require("./supplier_invoice.events");
const { matchThreeWay, buildPostingLines } = require("./supplier_invoice.rules");
const grnService = require("../goods_received/goods_received.service");
const journalEntry = require("../../finance/journal_entry/journal_entry.service");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { getRule } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "supplier_invoice:" + id;

async function replaceLines(client, id, lines) {
  await repo.deleteLines(client, id);
  for (const ln of lines) {
    // eslint-disable-next-line no-await-in-loop
    await repo.insertLine(client, { supplier_invoice_id: id, dictionary_item_id: ln.dictionary_item_id || null, label: ln.label || "Line", qty: ln.qty || 1, unit_price: ln.unit_price || 0, tax_code_id: ln.tax_code_id || null, expense_account: ln.expense_account || null });
  }
}

async function createDraft(client, { entityId, supplierId = null, poId = null, grnId = null, dossierId = null, supplierRef = null, currency = "XAF", vatTotal = 0, whtTotal = 0, dueOn = null, lines = [], actor = {} }) {
  await client.query("BEGIN");
  try {
    const si = await repo.insertSI(client, { entity_id: entityId, supplier_id: supplierId, po_id: poId, grn_id: grnId, dossier_id: dossierId, supplier_ref: supplierRef, currency, vat_total: vatTotal, wht_total: whtTotal, due_on: dueOn, status: "DRAFT" });
    if (lines.length) await replaceLines(client, si.supplier_invoice_id, lines);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(si.supplier_invoice_id), after: si });
    await client.query("COMMIT");
    return get(client, si.supplier_invoice_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function computeMatch(client, si, lineRows) {
  const invoiceHt = lineRows.reduce((s, l) => s + Number(l.unit_price) * Number(l.qty || 1), 0);
  const tolerance = await getRule(client, "procurement", "three_way_match", "tolerance_percent", 0);
  const poTot = si.po_id ? await repo.poTotal(client, si.po_id) : null;
  const grnExists = si.po_id ? (await repo.grnCountForPO(client, si.po_id)) > 0 : Boolean(si.grn_id);
  return matchThreeWay({ poTotal: poTot || 0, invoiceTotalHt: invoiceHt, grnExists, tolerancePercent: tolerance });
}

/** Run the three-way match and record MATCHED (or return reasons). */
async function match(client, { supplierInvoiceId, actor = {} }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (si.status !== "DRAFT") throw new AppError("BAD_STATE", "Only a DRAFT supplier invoice can be matched", 422);
  const lineRows = await repo.listLines(client, supplierInvoiceId);
  const result = await computeMatch(client, si, lineRows);
  await client.query("BEGIN");
  try {
    if (result.matched) {
      await repo.update(client, supplierInvoiceId, { status: "MATCHED" });
      const grns = si.po_id ? await grnService.list(client, { po_id: si.po_id }) : [];
      for (const g of grns) { /* eslint-disable-next-line no-await-in-loop */ await grnService.markMatched(client, g.grn_id, true); }
      // Open the tenant's configurable approval chain on a clean match (bound to
      // supplier_invoice.matched). No workflow bound → autoApproved; posting stays
      // an explicit step as today (BUILD_CONVENTIONS §2).
      await executor.start(client, { eventTypeKey: "supplier_invoice.matched", entityRef: ref(supplierInvoiceId), amountXaf: result.invoice_total === null || result.invoice_total === undefined ? null : Number(result.invoice_total) });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.MATCHED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), after: result });
    await client.query("COMMIT");
    return { supplier_invoice_id: supplierInvoiceId, ...result };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Post a MATCHED supplier invoice to the GL and capture the document. */
async function post(client, { supplierInvoiceId, entryDate, sourceDocRef, supplierAccount = "4011", actor = {}, ip = null }) {
  const si = await repo.getSI(client, supplierInvoiceId);
  if (!si) throw new AppError("NOT_FOUND", "Supplier invoice not found", 404);
  if (!["MATCHED", "DRAFT"].includes(si.status)) throw new AppError("BAD_STATE", "Supplier invoice must be MATCHED to post", 422);
  const lineRows = await repo.listLines(client, supplierInvoiceId);
  const built = buildPostingLines({ lines: lineRows, vatTotal: si.vat_total, whtTotal: si.wht_total, dossierId: si.dossier_id, supplierAccount });

  await client.query("BEGIN");
  try {
    const { entry } = await journalEntry.buildAndInsert(client, {
      journalCode: "AC", entityId: si.entity_id, entryDate,
      description: "Supplier invoice " + (si.supplier_ref || si.supplier_invoice_id), sourceDocRef: sourceDocRef || ref(supplierInvoiceId), source: "SYSTEM_RULE",
      lines: built.lines, validate: true, actor, ip,
    });
    const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: si.entity_id, date: entryDate });
    const updated = await repo.update(client, supplierInvoiceId, { status: "POSTED_LOCKED", doc_number: number, entry_id: entry.entry_id, amount_ht: built.amount_ht, amount_ttc: built.amount_ttc });
    await documents.capture(client, { entityRef: ref(supplierInvoiceId), docType: "SUPPLIER_INVOICE", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(supplierInvoiceId), after: { doc_number: number, entry_id: entry.entry_id, totals: built } });
    await client.query("COMMIT");
    return { supplier_invoice: updated, entry, doc_number: number, totals: built };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const si = await repo.getSI(client, id);
  if (!si) return null;
  si.lines = await repo.listLines(client, id);
  return si;
}
const list = (client, q) => repo.listSI(client, q);

// A cleared approval chain posts the matched supplier invoice (BUILD_CONVENTIONS §2/§5).
onApproved.register("supplier_invoice", (client, { id, actor }) =>
  post(client, { supplierInvoiceId: id, entryDate: new Date().toISOString().slice(0, 10), sourceDocRef: "approval:" + id, actor: actor || {} }));

module.exports = { createDraft, match, post, get, list };
