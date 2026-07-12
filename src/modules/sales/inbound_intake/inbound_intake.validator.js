"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const schemas = {
  enquiry: z.object({ name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), subject: z.string().optional(), message: z.string().optional(), source: z.string().optional() }),
  triage: z.object({ to_lead: z.boolean().optional(), close: z.boolean().optional() }),
  partnership: z.object({ company_name: z.string().optional(), contact_name: z.string().optional(), email: z.string().email().optional(), proposal_text: z.string().optional() }),
  review: z.object({ status: z.enum(["REVIEWING", "ACCEPTED", "DECLINED"]) }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { enquiry: mw("enquiry"), triage: mw("triage"), partnership: mw("partnership"), review: mw("review"), schemas };
