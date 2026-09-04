"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * A slug is lowercase ASCII with single hyphens, or absent.
 *
 * The same rule 12745 states for service profiles, and for the same reason: the
 * column is `text` rather than `citext` because case-insensitivity is a property
 * of this regex, not of the storage. Accented characters are refused rather than
 * transliterated here — a French title becomes `la-douane-en-2026` because
 * somebody wrote that slug, not because a machine guessed at it.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = z.string().trim().min(1).max(140).regex(SLUG, "lowercase letters, numbers and single hyphens")
  .optional().nullable();

const text = (max) => z.string().trim().max(max).optional().nullable();

/**
 * A tag is a short free-text label, normalised to lowercase on the way in.
 *
 * Normalising here rather than at read time is what stops "Strategy" and
 * "strategy" appearing as two filters in a bar that is derived from the tags in
 * use. The set is de-duplicated for the same reason.
 */
const tags = z
  .array(z.string().trim().min(1).max(40))
  .max(12)
  .transform((list) => [...new Set(list.map((t) => t.toLowerCase()))])
  .optional();

const base = {
  slug_fr: slug,
  slug_en: slug,
  title_en: text(200),
  excerpt_fr: text(500),
  excerpt_en: text(500),
  // Long, because this is the article. 200 kB is far more than anyone writes
  // and far less than an accident.
  body_fr: text(200000),
  body_en: text(200000),
  meta_title_fr: text(200),
  meta_title_en: text(200),
  meta_description_fr: text(320),
  meta_description_en: text(320),
  cover_vault_id: z.string().uuid().optional().nullable(),
  tags,
  author_user_id: z.string().uuid().optional().nullable(),
  sort_order: z.coerce.number().int().min(0).max(100000).optional(),
};

/**
 * The cover upload.
 *
 * A data URL, capped well above the vault's own 10 MB so an oversized file is
 * refused by the vault with a message about the file rather than here with a
 * message about the string. `original_name` is carried for the vault's records
 * and is never used to build a path — the storage key is the document id.
 */
const cover = z.object({
  data_url: z.string().min(1).max(14_000_000),
  original_name: z.string().trim().max(200).optional(),
}).strict();

/** The gallery order / removal write: the ids the article should carry, in
 *  display order. The service ignores any id that was not already the
 *  article's, so this cannot bind a foreign document to a public page. */
const gallery = z.object({
  ids: z.array(z.string().uuid()).max(12),
}).strict();

const schemas = {
  cover,
  gallery,
  // title_fr is the one thing an article cannot exist without: FR is the
  // default language and an untitled article has nothing to list.
  create: z.object({ ...base, title_fr: z.string().trim().min(1).max(200) }).strict(),
  update: z.object({ ...base, title_fr: z.string().trim().min(1).max(200).optional() }).strict(),
  publish: z.object({ published: z.boolean() }).strict(),
  listQuery: z.object({
    tag: z.string().trim().max(40).optional(),
    page: z.coerce.number().int().min(1).max(1000).optional(),
    per_page: z.coerce.number().int().min(1).max(50).optional(),
  }).strict(),
};

const mw = (key, source = "body") => (req, _res, next) => {
  const parsed = schemas[key].safeParse(req[source]);
  if (!parsed.success) {
    return next(new AppError(
      "VALIDATION_ERROR",
      "Please check the article",
      422,
      parsed.error.flatten().fieldErrors,
    ));
  }
  if (source === "body") req.body = parsed.data;
  else req.validatedQuery = parsed.data;
  return next();
};

/** DELETE takes no body. A payload on it is a caller who thinks it does. */
const noBody = z.object({}).strict();
const validateNoBody = (req, _res, next) => {
  if (!noBody.safeParse(req.body ?? {}).success) {
    return next(new AppError("VALIDATION_ERROR", "Body is not accepted on this endpoint", 422));
  }
  return next();
};

module.exports = {
  schemas,
  SLUG,
  validateNoBody,
  create: mw("create"),
  update: mw("update"),
  publish: mw("publish"),
  cover: mw("cover"),
  gallery: mw("gallery"),
  listQuery: mw("listQuery", "query"),
};
