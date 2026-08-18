"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const issue = z.object({
  holder_user_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  entity_id: z.string().uuid(),
  entry_date: DATE,
  source_doc_ref: z.string().min(1),
  policy_window_days: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
  exchange_rate_to_xaf: z.number().positive().optional(),
});

/**
 * `dossier_id` is required for a RECEIPT and meaningless for a CASH_RETURN, so
 * the rule is per-kind and lives here as a refinement rather than as a table
 * CHECK — a two-column conditional CHECK is harder to read, and 4731's
 * `requires_analytic` flag makes the database refuse the posting anyway.
 *
 * Proof is NOT required here even though the KB demands it: whether an
 * undocumented receipt is refused is `finance.regie.require_proof_for_receipt`,
 * a tenant setting the service reads. Hardcoding it in the schema would take
 * that decision away from the tenant and duplicate the check.
 */
const retire = z
  .object({
    kind: z.enum(["RECEIPT", "CASH_RETURN", "WRITE_OFF"]),
    dossier_id: z.string().uuid().optional(),
    amount: z.number().positive(),
    proof_vault_id: z.string().uuid().optional(),
    memo: z.string().max(2000).optional(),
    entity_id: z.string().uuid().optional(),
    entry_date: DATE.optional(),
    source_doc_ref: z.string().min(1).optional(),
  })
  .refine((v) => v.kind !== "RECEIPT" || !!v.dossier_id, {
    message: "A receipt must be tagged to a dossier",
    path: ["dossier_id"],
  });

const queryAdvance = z.object({ reason: z.string().min(1).max(2000) });

const writeOff = z.object({
  amount: z.number().positive().optional(), // defaults to the whole open balance
  memo: z.string().max(2000).optional(),
  entity_id: z.string().uuid().optional(),
  entry_date: DATE.optional(),
  source_doc_ref: z.string().min(1).optional(),
});

const unage = z.object({
  reason: z.string().max(2000).optional(),
  entry_date: DATE.optional(),
});

const ageDue = z.object({
  entity_id: z.string().uuid().optional(), // now stored on the advance (10717)
  entry_date: DATE,
  source_doc_ref: z.string().min(1),
});

/**
 * AI-surface schemas. The HTTP routes take the advance in the URL
 * (`/regie/:id/retire`), but an assistant call has no URL — it passes one flat
 * object — so each write action needs the id IN the schema. Same convention as
 * `debt.validator.aiDrawdown` (which carries `debt_id`).
 */
const aiRetire = z
  .object({
    regie_advance_id: z.string().uuid(),
    kind: z.enum(["RECEIPT", "CASH_RETURN", "WRITE_OFF"]),
    dossier_id: z.string().uuid().optional(),
    amount: z.number().positive(),
    proof_vault_id: z.string().uuid().optional(),
    memo: z.string().max(2000).optional(),
    entity_id: z.string().uuid().optional(),
    entry_date: DATE.optional(),
    source_doc_ref: z.string().min(1).optional(),
  })
  .refine((v) => v.kind !== "RECEIPT" || !!v.dossier_id, {
    message: "A receipt must be tagged to a dossier",
    path: ["dossier_id"],
  });

const aiQuery = z.object({
  regie_advance_id: z.string().uuid(),
  reason: z.string().min(1).max(2000),
});

const aiWriteOff = z.object({
  regie_advance_id: z.string().uuid(),
  amount: z.number().positive().optional(),
  memo: z.string().max(2000).optional(),
  entity_id: z.string().uuid().optional(),
  entry_date: DATE.optional(),
  source_doc_ref: z.string().min(1).optional(),
});

const aiUnage = z.object({
  regie_advance_id: z.string().uuid(),
  reason: z.string().max(2000).optional(),
  entry_date: DATE.optional(),
});

const schemas = {
  issue, retire, query: queryAdvance, writeOff, unage, ageDue,
  aiRetire, aiQuery, aiWriteOff, aiUnage,
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  issue: mw("issue"),
  retire: mw("retire"),
  query: mw("query"),
  writeOff: mw("writeOff"),
  unage: mw("unage"),
  ageDue: mw("ageDue"),
  schemas,
};
