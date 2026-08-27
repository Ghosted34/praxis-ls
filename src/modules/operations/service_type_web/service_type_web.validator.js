/**
 * Validators for the service-type web profile (guide §4.5).
 *
 * The fields are bilingual with one column per language (no "bilingual" text
 * field — guide §6 rule 11). Slugs and media go through stricter rules than
 * copy because renaming a live URL is an SEO decision (rule 6) and media
 * changes are refused while published.
 */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// Same shape success_story uses (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`). The shared
// helper (`src/shared/text/slug.js`) is what PRODUCES a slug that matches this;
// the validator's job is to refuse anything that does not match.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG = z.string().regex(SLUG_RE).min(1).max(80);

// Eight per language, hard cap (guide §2 decision 7). Stored as jsonb so the
// count is the only rule — content-length lives on the validator below.
const HIGHLIGHTS_MAX = 8;
const HIGHLIGHTS = z.array(z.string().trim().min(1).max(280)).max(HIGHLIGHTS_MAX);

// Video is an EXTERNAL EMBED, not a vault row (decision 3). The host
// allowlist is one validator array so the choice is in one place. Three
// hosts: YouTube + Vimeo (universal), Dailymotion (francophone relevance,
// called out in §11). Dailymotion in particular matters for the markets
// this product serves.
const VIDEO_HOST_ALLOW = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com",
  "dai.ly",
]);
const VIDEO_URL = z.string().trim().url().max(500).refine((value) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (VIDEO_HOST_ALLOW.has(host)) return true;
    // Accept embed paths too — youtube.com/embed/<id> is the canonical embed,
    // and the /watch?v= link is what people paste from the address bar.
    return host === "youtube.com" || host === "vimeo.com" || host === "dailymotion.com";
  } catch {
    return false;
  }
}, "Video URL must be on YouTube, Vimeo or Dailymotion");

const LONG_DESCRIPTION_MAX = 20000;
const SHORT_DESCRIPTION_MAX = 500;
const META_TITLE_MAX = 70;
const META_DESCRIPTION_MAX = 200;
const COVERAGE_MAX = 1000;
const QUESTION_MAX = 300;
const ANSWER_MAX = 4000;
const GALLERY_MAX = 12;
const FAQ_MAX = 12;

// The optional bilingual media-replace / FAQ / related shapes are scoped to
// their own handlers. The PROFILE upsert is the larger one below.
const profileFields = {
  short_description_fr: z.string().trim().max(SHORT_DESCRIPTION_MAX).nullable().optional(),
  short_description_en: z.string().trim().max(SHORT_DESCRIPTION_MAX).nullable().optional(),
  long_description_fr: z.string().trim().max(LONG_DESCRIPTION_MAX).nullable().optional(),
  long_description_en: z.string().trim().max(LONG_DESCRIPTION_MAX).nullable().optional(),
  highlights_fr: HIGHLIGHTS.optional(),
  highlights_en: HIGHLIGHTS.optional(),
  coverage_fr: z.string().trim().max(COVERAGE_MAX).nullable().optional(),
  coverage_en: z.string().trim().max(COVERAGE_MAX).nullable().optional(),
  slug_fr: SLUG.nullable().optional(),
  slug_en: SLUG.nullable().optional(),
  meta_title_fr: z.string().trim().max(META_TITLE_MAX).nullable().optional(),
  meta_title_en: z.string().trim().max(META_TITLE_MAX).nullable().optional(),
  meta_description_fr: z.string().trim().max(META_DESCRIPTION_MAX).nullable().optional(),
  meta_description_en: z.string().trim().max(META_DESCRIPTION_MAX).nullable().optional(),
  cover_vault_id: z.string().uuid().nullable().optional(),
  icon_vault_id: z.string().uuid().nullable().optional(),
  gallery_vault_ids: z.array(z.string().uuid()).max(GALLERY_MAX).optional(),
  video_url: VIDEO_URL.nullable().optional(),
  sort_order: z.number().int().min(0).max(10000).optional(),
};

// `.partial()` so omitted keys are unchanged on update (one writer per
// field, PATCH-style edits on the same verb). The service is what enforces
// "omitted keys are left alone"; the validator accepts them and stops here.
const upsertProfile = z.object(profileFields).strict();
const replaceFaq = z.object({
  rows: z
    .array(
      z.object({
        question_fr: z.string().trim().min(1).max(QUESTION_MAX),
        question_en: z.string().trim().min(1).max(QUESTION_MAX),
        answer_fr: z.string().trim().min(1).max(ANSWER_MAX),
        answer_en: z.string().trim().min(1).max(ANSWER_MAX),
        sort_order: z.number().int().min(0).max(10000).optional(),
      }).strict(),
    )
    .max(FAQ_MAX),
}).strict();
const replaceRelated = z.object({
  related_service_type_ids: z.array(z.string().uuid()).max(50),
}).strict().refine(
  (v) => new Set(v.related_service_type_ids).size === v.related_service_type_ids.length,
  { message: "duplicate related service ids are not allowed", path: ["related_service_type_ids"] },
);
const replaceMedia = z.object({
  role: z.enum(["COVER", "ICON", "GALLERY"]),
  data_url: z.string().min(1),
  original_name: z.string().trim().min(1).max(255).optional(),
}).strict();

const schemas = { upsertProfile, replaceFaq, replaceRelated, replaceMedia };

/**
 * Bodyless action (publish, unpublish) — accept an empty body and refuse
 * anything else. Same pattern as `service_type_field.validator.publish`:
 * `.strict()` rather than no validator at all, so a caller that sends
 * `{"is_published": true}` is told the field is not accepted, instead of
 * having it silently ignored.
 */
const noBody = z.object({}).strict();
const noBodyMw = (req, _res, next) => {
  const p = noBody.safeParse(req.body ?? {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Body is not accepted on this endpoint", 422, p.error.flatten().fieldErrors));
  return next();
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body ?? {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  upsertProfile: mw("upsertProfile"),
  replaceFaq: mw("replaceFaq"),
  replaceRelated: mw("replaceRelated"),
  replaceMedia: mw("replaceMedia"),
  validateNoBody: noBodyMw,
  schemas,
  // The share image and the share title/description both fall back to the
  // cover and the long name; the FE uses these to render the meta block, so
  // the constants are part of the contract the renderer relies on.
  LIMITS: {
    SHORT_DESCRIPTION_MAX,
    LONG_DESCRIPTION_MAX,
    META_TITLE_MAX,
    META_DESCRIPTION_MAX,
    COVERAGE_MAX,
    QUESTION_MAX,
    ANSWER_MAX,
    HIGHLIGHTS_MAX,
    GALLERY_MAX,
    FAQ_MAX,
  },
};
