"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ name: z.string().min(2), ref: z.string().optional(), entity_id: z.string().uuid().optional(), supplier_type: z.string().optional(), niu: z.string().optional(), rccm: z.string().optional(), payment_method: z.enum(["BANK","CASH","MOBILE_MONEY","CHEQUE"]).optional(), momo_network: z.string().optional(), momo_number: z.string().optional(), is_non_resident: z.boolean().optional(), rating: z.number().int().min(1).max(5).optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
