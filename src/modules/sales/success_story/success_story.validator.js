"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const kpi = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(80),
}).strict();

const fields = {
  title: z.string().trim().min(1).max(300),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  client_id: z.string().uuid().nullable().optional(),
  service_category: z.string().max(120).nullable().optional(),
  headline: z.string().max(300).nullable().optional(),
  executive_summary: z.string().max(5000).nullable().optional(),
  operations_execution: z.string().max(10000).nullable().optional(),
  kpis: z.array(kpi).max(4).optional(),
  dossier_ids: z.array(z.string().uuid()).min(1),
};

const schemas = {
  create: z.object(fields).strict(),
  update: z.object({ ...fields, title: fields.title.optional(), dossier_ids: fields.dossier_ids.optional() }).strict(),
  generate: z.object({
    dossier_ids: z.array(z.string().uuid()).min(1),
    rough_notes: z.string().max(10000).optional(),
  }).strict(),
  media: z.object({
    role: z.enum(["COVER", "CLIENT_LOGO", "GALLERY"]),
    data_url: z.string().min(1),
    original_name: z.string().trim().min(1).max(255).optional(),
  }).strict(),
};

const generatedDraft = z.object({
  headline: z.string().trim().min(1).max(300),
  executive_summary: z.string().trim().min(1).max(5000),
  operations_execution: z.string().trim().min(1).max(10000),
  kpis: z.array(kpi).min(3).max(4),
}).strict();

const middleware = (key) => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req.body);
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
  }
  req.body = parsed.data;
  return next();
};

module.exports = {
  schemas,
  generatedDraft,
  create: middleware("create"),
  update: middleware("update"),
  generate: middleware("generate"),
  media: middleware("media"),
};
