"use strict";

/**
 * Page and block bodies.
 *
 * Block CONTENT is deliberately `z.unknown()` here and validated in the service
 * against the type's own schema — the shape depends on `type`, and a validator
 * that tried to switch on it would be a second copy of the registry drifting
 * from the first.
 */

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { BLOCK_TYPES } = require("./site_content.schema");

const KEY = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/, "use lowercase letters, digits and hyphens");
const SLUG = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$|^[a-z0-9]$/, "use lowercase letters, digits and hyphens");
const TITLE_MAX = 160;
const META_TITLE_MAX = 70;
const META_DESCRIPTION_MAX = 200;

const pageFields = {
  title_fr: z.string().trim().min(1).max(TITLE_MAX),
  title_en: z.string().trim().max(TITLE_MAX).nullable().optional(),
  slug_fr: SLUG.nullable().optional(),
  slug_en: SLUG.nullable().optional(),
  meta_title_fr: z.string().trim().max(META_TITLE_MAX).nullable().optional(),
  meta_title_en: z.string().trim().max(META_TITLE_MAX).nullable().optional(),
  meta_description_fr: z.string().trim().max(META_DESCRIPTION_MAX).nullable().optional(),
  meta_description_en: z.string().trim().max(META_DESCRIPTION_MAX).nullable().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
};

const createPage = z.object({ key: KEY, ...pageFields }).strict();
const updatePage = z.object({
  key: KEY.optional(),
  ...pageFields,
  title_fr: pageFields.title_fr.optional(),
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: "send at least one field to change",
});

// is_published is NOT here: publishing stamps who and when, so it has its own
// endpoint rather than being a field an ordinary update could flip.
const setPublished = z.object({ published: z.boolean() }).strict();

const createBlock = z.object({
  type: z.enum(BLOCK_TYPES),
  content: z.unknown().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_visible: z.boolean().optional(),
}).strict();

// `type` is absent on purpose — a block's type is fixed at creation, because
// changing it would leave content shaped for the old one.
const updateBlock = z.object({
  content: z.unknown().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
  is_visible: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, {
  message: "send at least one field to change",
});

const reorderBlocks = z.object({
  block_ids: z.array(z.string().uuid()).min(1).max(200),
}).strict();

const schemas = { createPage, updatePage, setPublished, createBlock, updateBlock, reorderBlocks };

const mw = (k) => (req, _res, next) => {
  const parsed = schemas[k].safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, parsed.error.flatten().fieldErrors));
  }
  req.body = parsed.data;
  return next();
};

const noBody = z.object({}).strict();
const validateNoBody = (req, _res, next) => {
  const parsed = noBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    return next(new AppError("VALIDATION_ERROR", "Body is not accepted on this endpoint", 422));
  }
  return next();
};

module.exports = {
  schemas,
  createPage: mw("createPage"),
  updatePage: mw("updatePage"),
  setPublished: mw("setPublished"),
  createBlock: mw("createBlock"),
  updateBlock: mw("updateBlock"),
  reorderBlocks: mw("reorderBlocks"),
  validateNoBody,
};
