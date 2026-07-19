"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
// `logo_light_ref` / `logo_dark_ref` are the per-entity document logos (columns
// existed since 0100 but were previously unwritable — no validator field, so any
// value sent was silently dropped). They hold the /media URL produced by
// POST /entities/:id/logo; sending null clears one.
const logoRef = z.string().optional().nullable();
const schemas = {
  create: z.object({ code: z.string().min(1), legal_name: z.string().min(1), niu: z.string().optional().nullable(), rccm: z.string().optional().nullable(), country_code: z.string().length(2).optional(), address: z.string().optional().nullable(), bank_block: z.record(z.any()).optional(), doc_prefix: z.string().optional(), default_language: z.enum(["fr", "en"]).optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional(), logo_light_ref: logoRef, logo_dark_ref: logoRef }),
  update: z.object({ legal_name: z.string().optional(), niu: z.string().optional().nullable(), rccm: z.string().optional().nullable(), country_code: z.string().length(2).optional(), address: z.string().optional().nullable(), bank_block: z.record(z.any()).optional(), doc_prefix: z.string().optional(), default_language: z.enum(["fr", "en"]).optional(), fiscal_year_start_month: z.number().int().min(1).max(12).optional(), logo_light_ref: logoRef, logo_dark_ref: logoRef }),
  setActive: z.object({ active: z.boolean() }),
  logoUpload: z.object({ data_url: z.string().min(1), variant: z.enum(["light", "dark"]).optional() }),
};
const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};
module.exports = { create: mw("create"), update: mw("update"), setActive: mw("setActive"), logoUpload: mw("logoUpload"), schemas };
