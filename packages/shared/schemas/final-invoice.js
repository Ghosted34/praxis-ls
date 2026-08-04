"use strict";
/**
 * Final invoice payloads.
 *
 * Lifted VERBATIM in meaning from `src/modules/finance/final_invoice/
 * final_invoice.validator.js`, which is now the consumer rather than the owner.
 * This is the first domain moved because it is the one the audit names: F12
 * cites `features/finance/pages.tsx:141`'s `canSubmit` boolean as the client's
 * parallel, un-shared re-statement of these same rules.
 *
 * The only changes from the original are messages. The API's schema produced
 * Zod's defaults ("Invalid uuid"), which was acceptable when they were only
 * ever flattened into one banner. Now that the client renders them per FIELD
 * (see the Field `error` prop), they are read by an operator and need to say
 * something an operator can act on.
 */
const { z } = require("zod");
const { uuid, isoDate, requiredText, positiveAmount } = require("./common");

const line = z.object({
  dictionary_item_id: uuid,
  amount: positiveAmount,
  is_debours: z.boolean().optional(),
  label: z.string().optional(),
});

const createDraft = z.object({
  entity_id: uuid,
  client_id: uuid.optional(),
  dossier_id: uuid.optional(),
  lines: z.array(line).optional(),
});

const updateDraft = z.object({
  client_id: uuid.optional(),
  dossier_id: uuid.optional(),
  lines: z.array(line).optional(),
});

const submit = z.object({
  entry_date: isoDate,
  source_doc_ref: requiredText("Document reference"),
});

// AI-facing variants: the same payloads with the invoice identified in the body
// rather than the path, for the tool-calling surface.
const aiUpdate = updateDraft.extend({ invoice_id: uuid });
const aiSubmit = submit.extend({ invoice_id: uuid });

module.exports = { line, createDraft, updateDraft, submit, aiUpdate, aiSubmit };
