"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  save: z.object({ name: z.string().min(1), report_key: z.string().min(1), params: z.record(z.any()).optional(), is_shared: z.boolean().optional() }),
  setTile: z.object({ tile_key: z.string().min(1), position: z.number().int().nonnegative().optional(), is_visible: z.boolean().optional(), config: z.record(z.any()).optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { save: mw("save"), setTile: mw("setTile"), schemas };
