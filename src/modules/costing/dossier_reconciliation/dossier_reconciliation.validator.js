"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const UUID = z.string().uuid();
const MONEY = z.coerce.number().min(0).max(1e15);
// The wire format is ISO — that is what every `date` column and the @shared
// validators are built on. dd/mm/yyyy is what a PERSON reads (DateField does
// the conversion); it is never what crosses the API.
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const schemas = {
  dossierParam: z.object({ dossierId: UUID }),
  idParam: z.object({ id: UUID }),
  lineParam: z.object({ dossierId: UUID, costingLineId: UUID }),
  docParam: z.object({ dossierId: UUID, costingLineId: UUID, docId: UUID }),

  /**
   * Every field optional, and `.nullable()` on the ones a person can CLEAR.
   * The service reads "absent" and "null" as different instructions — omitting
   * `spent_on` leaves it alone, sending null empties it — so the schema has to
   * preserve that difference rather than defaulting anything.
   */
  patchLine: z.object({
    actual_ttc: MONEY.optional(),
    spent_on: ISO_DATE.nullable().optional(),
    variance_reason: z.string().trim().max(2000).nullable().optional(),
    returned_amount: MONEY.optional(),
  }).strict(),

  applyReason: z.object({
    reason: z.string().trim().min(3).max(2000),
    costing_line_ids: z.array(UUID).min(1).max(200),
  }),

  attachDocument: z.object({
    doc_id: UUID,
    note: z.string().trim().max(500).optional(),
  }),

  submit: z.object({ note: z.string().trim().max(2000).optional() }),
  reject: z.object({ reason: z.string().trim().min(3).max(2000) }),
  // A map of costing_line_id → amount returned to the vault.
  settle: z.object({ returned: z.record(UUID, MONEY).optional() }),
};

const mw = (key, fromParams = false) => (req, _res, next) => {
  const source = fromParams ? req.params : req.body;
  const parsed = schemas[key].safeParse(source);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid request", 422, parsed.error.flatten().fieldErrors));
  }
  if (fromParams) req.params = { ...req.params, ...parsed.data };
  else req.body = parsed.data;
  return next();
};

module.exports = {
  dossierParam: mw("dossierParam", true),
  idParam: mw("idParam", true),
  lineParam: mw("lineParam", true),
  docParam: mw("docParam", true),
  patchLine: mw("patchLine"),
  applyReason: mw("applyReason"),
  attachDocument: mw("attachDocument"),
  submit: mw("submit"),
  reject: mw("reject"),
  settle: mw("settle"),
  schemas,
};
