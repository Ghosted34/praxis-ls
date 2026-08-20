"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const schemas = {
  profile: z.object({
    signature_template_id: z.string().uuid().nullable().optional(),
    phone_desk: z.string().trim().max(40).nullable().optional(),
    phone_mobile: z.string().trim().max(40).nullable().optional(),
    whatsapp: z.string().trim().max(40).nullable().optional(),
    pronouns: z.string().trim().max(40).nullable().optional(),
    credentials: z.string().trim().max(120).nullable().optional(),
    booking_url: z.string().trim().max(500).nullable().optional(),
    language: z.enum(["en", "fr"]).nullable().optional(),
    extra: z.record(z.unknown()).optional(),
    is_enabled: z.boolean().optional(),
  }).strict(),
  templatePatch: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    layout: z.record(z.unknown()).optional(),
    copy_en: z.record(z.unknown()).optional(),
    copy_fr: z.record(z.unknown()).optional(),
    scope_kind: z.enum(["TENANT", "DEPARTMENT", "ENTITY"]).optional(),
    scope_value: z.string().trim().max(200).nullable().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
  }).strict(),
  png: z.object({
    language: z.enum(["en", "fr"]).optional(),
    scale: z.coerce.number().refine((n) => [1, 2, 3].includes(n), { message: "scale must be 1, 2 or 3" }).optional(),
  }).strict(),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body || {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { profile: mw("profile"), templatePatch: mw("templatePatch"), png: mw("png"), schemas };
