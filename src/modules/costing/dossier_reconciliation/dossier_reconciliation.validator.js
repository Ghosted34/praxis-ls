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
  unaccountedParam: z.object({ dossierId: UUID, costEntryId: UUID }),

  /** §8.1 (owner decision B): home an unaccounted spend entry on a budget
   *  line. One line, by id — the tray row already says which entry. */
  mapUnaccounted: z.object({
    costing_line_id: UUID,
  }).strict(),

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

  /**
   * The statement's format (Q19): the operator picks per download. Default
   * applied HERE, not in the controller — what the "default" is belongs in
   * the contract, where a reader of the routes can see it.
   */
  statementQuery: z.object({
    format: z.enum(["pdf", "xlsx"]).default("pdf"),
  }).strict(),

  /**
   * Where the statement goes in Smart Comms. `channel` (default) is the file's
   * own DOSSIER thread; `direct` needs the person. `note` overrides the
   * generated caption. `user_id` is only meaningful on a direct target.
   */
  sendStatement: z.object({
    target: z.enum(["channel", "direct"]).default("channel"),
    user_id: UUID.optional(),
    note: z.string().trim().max(2000).optional(),
  }).strict(),
};

const mw = (key, fromParams = false, fromQuery = false) => (req, _res, next) => {
  const source = fromParams ? req.params : fromQuery ? req.query : req.body;
  const parsed = schemas[key].safeParse(source);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid request", 422, parsed.error.flatten().fieldErrors));
  }
  if (fromParams) req.params = { ...req.params, ...parsed.data };
  else if (fromQuery) req.query = parsed.data;
  else req.body = parsed.data;
  return next();
};

module.exports = {
  dossierParam: mw("dossierParam", true),
  idParam: mw("idParam", true),
  lineParam: mw("lineParam", true),
  docParam: mw("docParam", true),
  unaccountedParam: mw("unaccountedParam", true),
  mapUnaccounted: mw("mapUnaccounted"),
  patchLine: mw("patchLine"),
  applyReason: mw("applyReason"),
  attachDocument: mw("attachDocument"),
  submit: mw("submit"),
  reject: mw("reject"),
  settle: mw("settle"),
  statementQuery: mw("statementQuery", false, true),
  sendStatement: mw("sendStatement"),
  schemas,
};
