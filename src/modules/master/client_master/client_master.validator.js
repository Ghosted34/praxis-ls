"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ name: z.string().min(2), ref: z.string().optional(), entity_id: z.string().uuid().optional(), client_type_id: z.string().uuid().optional(), niu: z.string().optional(), rccm: z.string().optional(), payment_terms_days: z.number().int().min(0).optional(), credit_limit: z.number().nonnegative().optional(), is_withholding_agent: z.boolean().optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
