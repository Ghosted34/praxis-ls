"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  // SEC H3 guard + SEC H1. POST /actions/:id/confirm carries the EDITED payload
  // for a confirmed AI action, and nothing validated it. The orchestrator does
  // re-validate it against the catalogue's payload_schema before executing —
  // which is the substantive check — but that happens after the body has been
  // read, and only when `edited` is an object. A non-object, an array or a
  // 50 MB blob got that far unexamined.
  //
  // Bounded rather than shaped: the payload's real schema is per-action and
  // lives in ai_action_catalogue, so duplicating it here would give two places
  // to change and one of them would drift.
  confirm: z.object({
    payload: z.record(z.string().max(64), z.unknown()).optional(),
  }).strict(),
  // Bounded message length (audit 3.7). A very long message inflates the
  // embedding cost, the system prompt, and every replayed turn. 10,000 chars
  // is ~2,500 tokens — enough for a detailed question with pasted context,
  // short enough that a runaway client can't burn the budget on embeddings
  // alone. The streaming endpoint shares this schema.
  ask: z.object({
    message: z.string().min(1).max(10000),
    conversation_id: z.string().uuid().optional(),
  }),
  // Excel export of an answer's tables. Bounded rather than shaped-in-detail:
  // the rows are markdown cells lifted from a reply the caller already has on
  // screen, so nothing here widens what they can read — the limits are about
  // refusing to build an unbounded workbook, not about access.
  exportTables: z.object({
    tables: z
      .array(
        z.object({
          title: z.string().max(200).optional(),
          header: z.array(z.string().max(500)).min(1).max(60),
          rows: z.array(z.array(z.string().max(2000)).max(60)).max(5000),
        }),
      )
      .min(1)
      .max(25),
  }).strict(),
};
const validate = (key) => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
  }
  req.body = parsed.data;
  return next();
};
module.exports = { validate, schemas };
