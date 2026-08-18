/**
 * Reconciliation validators (MOD-09). Zod, per doc/CONVENTIONS.md.
 *
 * The upload shape rides the same base64 data-URL convention as the document
 * vault and the financial-dictionary importer, so there is exactly one upload
 * idiom in the product and no multipart middleware to add.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { FIELD_ORDER } = require("./reconciliation.rules");

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const upload = z.object({
  treasury_account_id: uuid,
  file: z.string().min(1),
  filename: z.string().max(300).optional(),
  statement_profile_id: uuid.optional(),
});

/**
 * A column map: canonical field -> source column name. Keys are restricted to
 * the declared vocabulary so a typo cannot create a field the applier will
 * silently ignore.
 */
const columnMap = z.object(
  Object.fromEntries(FIELD_ORDER.map((f) => [f, z.string().min(1).max(200).nullish()])),
).strict();

const profileConfirm = z.object({
  entity_id: uuid,
  source_kind: z.enum(["CSV", "XLSX", "PDF", "CAMT053", "MT940", "MANUAL"]),
  institution: z.string().max(200).optional().nullable(),
  label: z.string().max(200).optional(),
  header_signature: z.string().length(64).optional().nullable(),
  column_map: columnMap,
  sign_convention: z.enum(["SIGNED_AMOUNT", "DEBIT_CREDIT_COLUMNS", "AMOUNT_WITH_INDICATOR"]).optional(),
  debit_indicators: z.array(z.string().min(1).max(32)).max(20).optional(),
  date_format: z.string().max(24).optional(),
  decimal_separator: z.enum([",", "."]).optional(),
  thousands_separator: z.string().max(2).optional(),
  encoding: z.string().max(32).optional(),
  delimiter: z.string().max(2).optional().nullable(),
  header_row_index: z.number().int().min(1).max(200).optional(),
  data_start_row: z.number().int().min(1).max(500).optional().nullable(),
  proposed_by_ai: z.boolean().optional(),
  ai_confidence: z.number().min(0).max(1).optional().nullable(),
});

const matchRun = z.object({
  // Widening these is a real decision (a bigger window means weaker evidence),
  // so they are bounded rather than free.
  near_days: z.number().int().min(0).max(30).optional(),
  far_days: z.number().int().min(0).max(90).optional(),
  auto_confirm: z.boolean().optional(),
});

const schemas = {
  preview: upload.omit({ statement_profile_id: true }),
  import: upload,
  profileConfirm,
  matchRun,
  matchReject: z.object({ reason: z.string().max(500).optional() }),
  manualMatch: z.object({ statement_line_id: uuid, journal_line_id: uuid }),
  ignoreLine: z.object({ reason: z.string().max(500).optional() }),
  buildReconciliation: z.object({
    treasury_account_id: uuid,
    statement_id: uuid.optional(),
    period_start: isoDate.optional(),
    period_end: isoDate.optional(),
  }),
  cashCount: z.object({
    treasury_account_id: uuid,
    counted_on: isoDate.optional(),
    // Either a full count sheet or a bare total. The service derives the total
    // from the sheet when both are present and rejects a disagreement.
    denominations: z.array(z.object({
      note: z.number().positive(),
      qty: z.number().int().min(0),
    })).max(40).optional(),
    counted_total: z.number().nonnegative().optional(),
    witness_user_id: uuid.optional().nullable(),
    variance_reason: z.string().max(1000).optional().nullable(),
  }).refine((v) => (v.denominations !== null && v.denominations !== undefined) || (v.counted_total !== null && v.counted_total !== undefined), {
    message: "Provide either a denomination breakdown or a counted total",
  }),
  attestCashCount: z.object({ variance_reason: z.string().max(1000).optional() }),

  // AI-facing shapes: id in the payload, per the picker-action convention.
  aiRunMatcher: z.object({ statement_id: uuid }).merge(matchRun.partial()),
  aiBuildReconciliation: z.object({
    treasury_account_id: uuid,
    period_start: isoDate.optional(),
    period_end: isoDate.optional(),
  }),
};

const mw = (key) => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
  }
  req.body = parsed.data;
  return next();
};

module.exports = {
  preview: mw("preview"),
  import: mw("import"),
  profileConfirm: mw("profileConfirm"),
  matchRun: mw("matchRun"),
  matchReject: mw("matchReject"),
  manualMatch: mw("manualMatch"),
  ignoreLine: mw("ignoreLine"),
  buildReconciliation: mw("buildReconciliation"),
  cashCount: mw("cashCount"),
  attestCashCount: mw("attestCashCount"),
  schemas,
};
