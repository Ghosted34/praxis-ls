"use strict";
// Reads + id-path mark-read need no body. Preferences (1.2) is the one write:
// a batch of per-channel/category opt-outs the caller sets for themselves.
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const CHANNELS = ["IN_APP", "EMAIL", "SMS", "WHATSAPP"];

const schemas = {
  preferences: z.object({
    preferences: z.array(
      z.object({
        channel: z.enum(CHANNELS),
        category: z.string().min(1).max(64),
        enabled: z.boolean(),
      }),
    ).min(1).max(200),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { preferences: mw("preferences"), CHANNELS, schemas };
