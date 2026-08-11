"use strict";
/**
 * Journal entry payloads — the SHAPE of a posting request.
 *
 * Lifted in meaning from `src/modules/finance/journal_entry/
 * journal_entry.validator.js`, which is now the consumer rather than the owner.
 *
 * WHAT IS DELIBERATELY NOT HERE: balanced-ness, one-side-per-line, the
 * two-decimal limit, the minimum of two lines' CONTENT. Those are domain
 * invariants with their own API error codes, and they live in
 * `rules/ledger.js`. See that file's header for why a `.refine()` would have
 * been the wrong home — in short, it would collapse five distinct error codes
 * into one `VALIDATION_ERROR` and break the four test files that assert them.
 *
 * The `lines: z.array(line).min(2)` below is the exception, and it is a shape
 * rule as well as an invariant: an array of one is malformed regardless of what
 * is in it, and the API has always rejected it here.
 *
 * As with final-invoice, the only changes from the original are the MESSAGES.
 * The API's produced Zod defaults ("Invalid uuid"), which was fine when they
 * were flattened into one banner; the client now renders them per field, where
 * an operator reads them.
 */
const { z } = require("zod");
const { uuid, isoDate, requiredText, currency } = require("./common");

/**
 * `debit` / `credit` accept a numeric string as well as a number, because that
 * is what an `<input type="number">` produces — but unlike `common.amount` they
 * also accept "", which is how a form represents "this side is empty". Coercing
 * "" to 0 here rather than at each call site is what lets the ledger rules see
 * a consistent shape.
 */
const side = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || v === "") return undefined;
    return typeof v === "number" ? v : Number(String(v).replace(/\s/g, ""));
  })
  .refine((n) => n === undefined || (Number.isFinite(n) && n >= 0), "Enter an amount of zero or more.");

const line = z.object({
  account_code: requiredText("Account"),
  debit: side,
  credit: side,
  dossier_id: uuid.optional(),
  dictionary_item_id: uuid.optional(),
  is_disbursement: z.boolean().optional(),
  tax_code_id: uuid.optional(),
  currency: currency.optional(),
  fx_rate: z.number().positive("Rate must be greater than zero.").optional(),
});

const post = z
  .object({
    journal_code: z.string().trim().min(1, "Choose a journal.").optional(),
    journal_id: uuid.optional(),
    entity_id: uuid,
    entry_date: isoDate,
    description: z.string().optional(),
    source_doc_ref: z.string().optional(),
    source: z.enum(["SYSTEM_AUTO", "SYSTEM_RULE", "HUMAN_MANUAL", "HUMAN_CORRECTION"]).optional(),
    validate: z.boolean().optional(),
    lines: z.array(line).min(2, "A journal entry needs at least two lines."),
  })
  .refine((v) => v.journal_code || v.journal_id, {
    message: "Choose a journal.",
    // Pointed at `journal_code`, which is the field the form actually renders —
    // an error with no reachable path renders nowhere.
    path: ["journal_code"],
  });

const reverse = z.object({
  reason: z.string().optional(),
  entry_date: isoDate.optional(),
});

// AI-facing variant: the entry identified in the body rather than the path.
const aiReverse = reverse.extend({ entry_id: uuid });

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.line = line;
exports.post = post;
exports.reverse = reverse;
exports.aiReverse = aiReverse;
