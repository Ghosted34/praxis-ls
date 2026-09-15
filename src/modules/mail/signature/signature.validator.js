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
  // A motto is one line of display copy in a script face; it wraps badly and
  // renders on a fixed-width card, so the cap is a rendering constraint rather
  // than a storage one. Empty string is how a motto is cleared.
  motto: z.object({
    en: z.string().max(120).optional(),
    fr: z.string().max(120).optional(),
  }).refine((v) => v.en !== undefined || v.fr !== undefined, {
    message: "Provide a motto for at least one language",
  }),
  /**
   * WHICH BRAND COLOUR PAINTS WHICH PART OF THE CARD.
   *
   * An ENUM of brand-colour NAMES, never a colour. That is the whole control:
   * a hex here would be a second place to set the brand, and the first place
   * for the brand and the signature to disagree. `null` hands the role back to
   * its default mapping.
   *
   * The keys are repeated rather than imported from signature.palette so this
   * file stays a plain schema module — and `mail-signature-card.test.js` asserts
   * the two lists are the same, which is the guard that matters.
   */
  palette: z.object({
    ink: z.enum(["primary", "secondary", "accent", "accentDeep", "accentGlow"]).nullable().optional(),
    glow: z.enum(["primary", "secondary", "accent", "accentDeep", "accentGlow"]).nullable().optional(),
    warm: z.enum(["primary", "secondary", "accent", "accentDeep", "accentGlow"]).nullable().optional(),
  }).strict().refine(
    (v) => v.ink !== undefined || v.glow !== undefined || v.warm !== undefined,
    { message: "Name at least one role to change" },
  ),
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
  // Capped at 200 because each entry is a headless-Chromium screenshot held in
  // memory until the archive is built. The service enforces the same bound —
  // this one keeps an absurd request from reaching it at all.
  batch: z.object({
    user_ids: z.array(z.string().uuid()).min(1).max(200),
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

module.exports = {
  profile: mw("profile"), templatePatch: mw("templatePatch"), motto: mw("motto"),
  palette: mw("palette"), png: mw("png"), batch: mw("batch"), schemas,
};
