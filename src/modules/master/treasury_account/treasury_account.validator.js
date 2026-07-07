"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ entity_id: z.string().uuid().optional(), kind: z.enum(["BANK","CASH","MOMO"]), label: z.string().min(1), coa_code: z.string(), momo_network: z.string().optional(), momo_fee_account: z.string().optional(), currency: z.string().length(3).optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
