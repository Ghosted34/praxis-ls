"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ name: z.string().min(1), lead_id: z.string().uuid().optional().nullable(), client_id: z.string().uuid().optional().nullable(), pipeline_stage_id: z.string().uuid().optional().nullable(), estimated_value: z.number().nonnegative().optional().nullable(), currency: z.string().length(3).optional(), owner_user_id: z.string().uuid().optional().nullable(), probability: z.number().min(0).max(100).optional().nullable() }),
  update: z.object({ name: z.string().optional(), estimated_value: z.number().nonnegative().optional().nullable(), currency: z.string().length(3).optional(), owner_user_id: z.string().uuid().optional().nullable(), probability: z.number().min(0).max(100).optional().nullable() }),
  move: z.object({ pipeline_stage_id: z.string().uuid() }),
  win: z.object({ create_dossier: z.boolean().optional(), entity_id: z.string().uuid().optional().nullable(), service_type_id: z.string().uuid().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), move: mw("move"), win: mw("win"), schemas };
