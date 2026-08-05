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
  ask: z.object({
    message: z.string().min(1),
    conversation_id: z.string().uuid().optional(),
  }),
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
