"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
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
