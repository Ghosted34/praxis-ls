"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  create: z.object({ company_name: z.string().min(1), contact_name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), source: z.enum(["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"]).optional(), service_interest: z.string().optional(), owner_user_id: z.string().uuid().optional().nullable(), details: z.record(z.any()).optional() }),
  update: z.object({ company_name: z.string().optional(), contact_name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), source: z.enum(["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"]).optional(), service_interest: z.string().optional(), owner_user_id: z.string().uuid().optional().nullable() }),
  transition: z.object({ to: z.enum(["CONTACTED", "QUALIFIED", "LOST"]) }),
  convert: z.object({ client: z.record(z.any()).optional() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), convert: mw("convert"), schemas };
