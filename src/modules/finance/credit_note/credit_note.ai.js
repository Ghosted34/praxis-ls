/**
 * AI action manifest (AI_ARCHITECTURE §2) for credit notes (MOD-51).
 *
 * A credit note is how a posted FINAL invoice is undone — the ledger is never
 * edited in place (KB §23.16) — so "cancel that invoice" is one of the things
 * an operator most often asks for in words. It had no manifest, so the
 * assistant could neither find one nor raise one.
 */
"use strict";

const service = require("./credit_note.service");
const validator = require("./credit_note.validator");

const MOD = "MOD-51";

module.exports = {
  entity: "credit_note",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_credit_notes", service: service.list, permission: { module: MOD, action: "view" }, describe: "List credit notes (filter by entity, client, dossier or status)." },
    { key: "get_credit_note", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one credit note by id, with its lines." },
  ],

  writes: [
    {
      key: "draft_credit_note",
      service: (c, p, actor) => service.createDraft(c, { entityId: p.entity_id, clientId: p.client_id, dossierId: p.dossier_id, reversesInvoiceId: p.reverses_invoice_id, lines: p.lines || [], actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Draft a credit note, optionally against the FINAL invoice it reverses. Nothing posts until it is approved.",
    },
    {
      key: "update_credit_note",
      service: (c, p, actor) => (({ credit_note_id, lines, ...patch }) => service.updateDraft(c, { creditNoteId: credit_note_id, patch, lines: lines === undefined ? null : lines, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Edit a DRAFT credit note by id (client, dossier, the invoice it reverses, or its lines).",
    },
    {
      key: "post_credit_note",
      service: (c, p, actor) => service.post(c, { creditNoteId: p.credit_note_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref, actor }),
      schema: validator.schemas.aiPost,
      permission: { module: MOD, action: "approve" },
      confirm: true,
      describe: "Post a credit note by id: allocate its number and write the reversing sale entry to the ledger.",
    },
  ],
};
