"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ code: z.string().min(1), legal_name: z.string().min(2), niu: z.string().optional(), rccm: z.string().optional(), country_code: z.string().length(2).optional(), address: z.string().optional(), doc_prefix: z.string().optional(), default_language: z.enum(["fr","en"]).optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
