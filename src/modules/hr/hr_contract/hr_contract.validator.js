"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/** A contract is a calendar fact — an accepted timestamp would put a timezone
 *  between the agreed start date and the probation date derived from it. */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  kind: z.enum(["OFFER_LETTER", "EMPLOYMENT", "CONFIRMATION", "TERMINATION"]),
  effective_on: d.optional(),
  end_on: d.optional(),
  status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]).optional(),
  pdf_vault_id: z.string().uuid().optional(),
  // Terms (0700). Editable directly as well as through a draft, because an HR
  // officer correcting a notice period should not have to re-run the model.
  title: z.string().max(200).optional(),
  body_md: z.string().max(60000).optional(),
  entity_id: z.string().uuid().optional(),
  job_title: z.string().max(160).optional(),
  gross_salary: z.number().nonnegative().optional(),
  salary_currency: z.string().length(3).optional(),
  probation_months: z.number().int().min(0).max(24).optional(),
  notice_days: z.number().int().min(0).max(365).optional(),
  working_hours: z.string().max(200).optional(),
  place_of_work: z.string().max(200).optional(),
  vacancy_id: z.string().uuid().optional(),
  renews_contract_id: z.string().uuid().optional(),
  signed_on: d.optional(),
  signed_by_name: z.string().max(160).optional(),
  countersigned_by_name: z.string().max(160).optional(),
});
const status = z.object({ status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]) });

/* What the drafter is TOLD. Every one of these is a term the parties agreed;
 * the model writes the prose around them and never decides one (see
 * hr_contract.draft). They are optional because a first draft is often made
 * before the salary is settled — the clause is then omitted rather than
 * invented. */
const draft = z.object({
  title: z.string().max(200).optional(),
  entity_id: z.string().uuid().optional(),
  job_title: z.string().max(160).optional(),
  effective_on: d.optional(),
  end_on: d.optional(),
  gross_salary: z.number().nonnegative().optional(),
  salary_currency: z.string().length(3).optional(),
  probation_months: z.number().int().min(0).max(24).optional(),
  notice_days: z.number().int().min(0).max(365).optional(),
  working_hours: z.string().max(200).optional(),
  place_of_work: z.string().max(200).optional(),
  vacancy_id: z.string().uuid().optional(),
});

const schemas = { create, update: create.partial(), status, draft };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), draft: mw("draft"), schemas };
