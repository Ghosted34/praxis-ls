"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const APPLICANT_STATUS = ["APPLIED", "SHORTLISTED", "INTERVIEWED", "HIRED", "REJECTED", "TALENT_POOL"];

const create = z.object({
  title: z.string().min(1),
  department: z.string().optional(),
  description: z.string().optional(),
  ai_generated: z.boolean().optional(),
  status: z.enum(["DRAFT", "OPEN", "CLOSED"]).optional(),
  posted_to_website: z.boolean().optional(),
});
const status = z.object({ status: z.enum(["DRAFT", "OPEN", "CLOSED"]) });
const applicant = z.object({
  full_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  cv_vault_id: z.string().uuid().optional(),
  answers_json: z.record(z.any()).optional(),
});
const applicantStatus = z.object({ status: z.enum(APPLICANT_STATUS) });
const schemas = { create, update: create.partial(), status, applicant, applicantStatus };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  status: mw("status"),
  applicant: mw("applicant"),
  applicantStatus: mw("applicantStatus"),
  schemas,
};
