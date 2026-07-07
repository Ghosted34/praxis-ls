"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const rule = z.object({ applies_context: z.enum(["sale","purchase","disbursement"]), debit_account: z.string().optional(), credit_account: z.string().optional(), tax_code_id: z.string().uuid().optional(), is_debours: z.boolean().optional() });
const create = z.object({ code: z.string().min(1), label_fr: z.string().min(1), label_en: z.string().optional(), description: z.string().optional(), category: z.enum(["debours","service","overhead","asset","other"]), is_debours: z.boolean().optional(), default_price: z.number().nonnegative().optional(), currency: z.string().length(3).optional(), shipping_line: z.string().optional(), service_type_key: z.string().optional(), posting_rules: z.array(rule).min(1) });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
