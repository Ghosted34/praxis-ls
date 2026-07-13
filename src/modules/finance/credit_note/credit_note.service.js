/**
 * Credit note (MOD-51, KB §8) — a document that reverses (all or part of) a
 * FINAL invoice. Stored as an invoice row type='CREDIT_NOTE' linked to the
 * original via reverses_invoice_id. Lifecycle: createDraft → updateDraft (while
 * DRAFT) → post. Posting determines the lines as a sale and books the REVERSE of
 * that entry (debit/credit swapped) to the sales journal, so revenue and output
 * VAT are reduced and the customer receivable is credited. All SQL is in the repo.
 */
"use strict";

const repo = require("./credit_note.repo");
const events = require("./credit_note.events");
const journalEntry = require("../journal_entry/journal_entry.service");
const determination = require("../../../services/accounting/determination");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "invoice:" + id;

async function replaceLines(client, invoiceId, lines) {
  await repo.deleteLines(client, invoiceId);
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    // eslint-disable-next-line no-await-in-loop
    await repo.insertLine(client, {
      invoice_id: invoiceId, dictionary_item_id: ln.dictionary_item_id || null,
      label: ln.label || "Line", qty: 1, unit_price: ln.amount, is_debours: ln.is_debours === true,
      line_ht: ln.amount, line_no: i + 1,
    });
  }
}

const econLinesFrom = (lineRows, dossierId) =>
  lineRows.map((l) => ({ dictionary_item_id: l.dictionary_item_id, amount: Number(l.line_ht), is_debours: l.is_debours, dossier_id: dossierId }));

async function createDraft(client, opts) {
  const { entityId, clientId = null, dossierId = null, reversesInvoiceId = null, lines = [], actor = {} } = opts;
  await client.query("BEGIN");
  try {
    if (reversesInvoiceId) {
      const orig = await repo.getInvoice(client, reversesInvoiceId);
      if (!orig) throw new AppError("NOT_FOUND", "Original invoice not found", 404);
      if (orig.type !== "FINAL") throw new AppError("BAD_ORIGINAL", "A credit note can only reverse a FINAL invoice", 422);
    }
    const cn = await repo.insertInvoice(client, {
      entity_id: entityId, client_id: clientId, dossier_id: dossierId, type: "CREDIT_NOTE",
      status: "DRAFT", reverses_invoice_id: reversesInvoiceId, issued_by: actor.user_id || null,
    });
    if (lines.length) await replaceLines(client, cn.invoice_id, lines);
    await audit(client, { actorUserId: actor.user_id || null, action: events.DRAFTED, moduleKey: events.MODULE, entityRef: ref(cn.invoice_id), after: cn });
    await client.query("COMMIT");
    return get(client, cn.invoice_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { creditNoteId, patch = {}, lines = null, actor = {} }) {
  const cn = await repo.getInvoice(client, creditNoteId);
  if (!cn || cn.type !== "CREDIT_NOTE") throw new AppError("NOT_FOUND", "Credit note not found", 404);
  if (cn.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT credit note can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["client_id", "dossier_id", "reverses_invoice_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (Object.keys(fields).length) await repo.updateInvoice(client, creditNoteId, fields);
    if (Array.isArray(lines)) await replaceLines(client, creditNoteId, lines);
    await audit(client, { actorUserId: actor.user_id || null, action: "credit_note.updated", moduleKey: events.MODULE, entityRef: ref(creditNoteId), after: fields });
    await client.query("COMMIT");
    return get(client, creditNoteId);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Post the credit note: book the reverse of the equivalent sale, number + capture. */
async function post(client, { creditNoteId, entryDate, sourceDocRef = null, actor = {}, ip = null }) {
  const cn = await repo.getInvoice(client, creditNoteId);
  if (!cn || cn.type !== "CREDIT_NOTE") throw new AppError("NOT_FOUND", "Credit note not found", 404);
  if (cn.status !== "DRAFT") throw new AppError("BAD_STATE", "Only a DRAFT credit note can be posted (was " + cn.status + ")", 422);
  const lineRows = await repo.listLines(client, creditNoteId);
  if (lineRows.length === 0) throw new AppError("NO_LINES", "Credit note has no lines", 422);
  const econLines = econLinesFrom(lineRows, cn.dossier_id);
  const date = entryDate || new Date().toISOString().slice(0, 10);

  await client.query("BEGIN");
  try {
    const determined = await determination.resolve(client, { context: "sale", counterpartAccount: "4111", entryDate: date, lines: econLines });
    // Reverse the sale entry: swap debit/credit on every determined line so
    // revenue (707/705) and output VAT (443) are debited and the client
    // receivable (4111) is credited — the mirror of the original invoice.
    const reversedLines = determined.lines.map((l) => ({
      account_code: l.account_code, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0, dossier_id: l.dossier_id,
    }));
    const saleEntry = await journalEntry.buildAndInsert(client, {
      journalCode: "VT", entityId: cn.entity_id, entryDate: date,
      description: "Credit note" + (cn.reverses_invoice_id ? " for invoice " + cn.reverses_invoice_id : ""),
      sourceDocRef: sourceDocRef || ref(creditNoteId), source: "SYSTEM_RULE",
      lines: reversedLines, validate: true, actor, ip,
    });
    const { number } = await numbering.allocate(client, { moduleKey: events.NUMBER_KEY, entityId: cn.entity_id, date });
    const updated = await repo.updateInvoice(client, creditNoteId, {
      status: "POSTED_LOCKED", doc_number: number, entry_id: saleEntry.entry.entry_id,
      service_ht: determined.totals.subtotal_ht, debours_total: determined.totals.debours_total,
      vat_total: determined.totals.tax_total, total_ttc: determined.totals.total,
    });
    await documents.capture(client, { entityRef: ref(creditNoteId), docType: "CREDIT_NOTE", status: "VERIFIED" });
    await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(creditNoteId), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(creditNoteId), after: { doc_number: number, totals: determined.totals }, ip });
    await client.query("COMMIT");
    return { credit_note: updated, entry: saleEntry.entry, doc_number: number, totals: determined.totals };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const list = (client, q) => repo.listCreditNotes(client, q);
async function get(client, id) {
  const cn = await repo.getInvoice(client, id);
  if (!cn || cn.type !== "CREDIT_NOTE") return null;
  cn.lines = await repo.listLines(client, id);
  return cn;
}

module.exports = { createDraft, updateDraft, post, list, get };
