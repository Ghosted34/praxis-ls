"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ code: z.string().min(2), parent_code: z.string().optional(), label_fr: z.string().min(1), label_en: z.string().optional(), class: z.number().int().min(1).max(9), normal_balance: z.enum(["D","C"]), is_postable: z.boolean().optional(), requires_analytic: z.boolean().optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
