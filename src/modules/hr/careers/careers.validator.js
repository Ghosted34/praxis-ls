"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * The one form on this product a stranger can post to.
 *
 * Every field is bounded. Not as ceremony: an unauthenticated endpoint with an
 * unbounded text field is free storage for anybody who finds it, and the
 * covering note in particular is the obvious candidate. The limits below are
 * generous for a real application and useless for anything else.
 */
const apply = z.object({
  full_name: z.string().trim().min(2).max(160),
  // Required here though optional on the admin form — a recruiter adding
  // somebody they met has other ways to reach them; a stranger who applies
  // with no way to be contacted has not applied.
  email: z.string().email().max(200),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(300).optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(30)
    .transform((a) => [...new Set(a.map((s) => s.trim()).filter(Boolean))])
    .optional(),
  experience_years: z.coerce.number().min(0).max(70).optional(),
  expected_salary: z.coerce.number().nonnegative().max(1e12).optional(),
  portfolio_url: z.string().url().max(500).optional(),
  cover_note: z.string().max(5000).optional(),
  // ~11 MB of base64 for an 8 MB file. Checked again on the decoded bytes in
  // document_vault.createDocument — this is the cheap outer bound that stops a
  // 200 MB string being base64-decoded into memory before anything looks at it.
  cv_data_url: z.string().max(12_000_000).optional(),
  cv_filename: z.string().max(200).optional(),
});

/**
 * The two fields that are not a question (13792).
 *
 * `website_url` is a honeypot — a real applicant never sees the input and never
 * fills it, so anything in it came from something reading the DOM. Bounded at
 * length 0 rather than being rejected outright, because a browser that
 * autofilled a blank is still a person.
 *
 * `form_started_at` is its partner: a human does not read a page, type a name
 * and an email and press send inside a second and a half. Both are stripped
 * before the body reaches a service — they are evidence, not data — exactly as
 * `public_intake.validator` does with the same pair on the quote and contact
 * forms.
 *
 * They are on the NEW public writes only. Adding them to `apply` above would
 * change the behaviour of an endpoint whose form is already in circulation, and
 * that is a separate decision from this one.
 */
const trap = {
  website_url: z.string().max(0).optional(),
  form_started_at: z.number().int().optional(),
};

/**
 * An application with no role attached.
 *
 * The same fields as `apply` and the same bounds, minus nothing — a candidate
 * writing in on spec is answering FEWER questions, not different ones, and a
 * second set of limits on the same columns is a second set to keep in step.
 * `.strict()` because it is new: an unknown key here is a caller bug or a
 * probe, and silently dropping it is how both go unnoticed.
 */
const openApplication = apply.extend(trap).strict();

/**
 * A job alert.
 *
 * `locale` is what language the page was being read in, not a preference the
 * visitor set — so it is optional and defaults to French at the column, and an
 * unrecognised value is refused rather than coerced. Mailing somebody in a
 * language they did not ask in is the defect this field exists to prevent, and
 * guessing is how it happens anyway.
 */
const alert = z.object({
  ...trap,
  email: z.string().email().max(200),
  name: z.string().trim().max(160).optional(),
  locale: z.enum(["en", "fr"]).optional(),
}).strict();

/**
 * Unsubscribing carries no body at all.
 *
 * The token is in the path and there is nothing else to say, so the schema is
 * the empty object and `.strict()` refuses everything — which is the point.
 * Without a schema here the route's body keys reach the repo as column
 * identifiers (SEC H3); with one that accepts nothing, there is no body to
 * mass-assign from.
 */
const unsubscribe = z.object({}).strict();

const schemas = { apply, openApplication, alert, unsubscribe };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Please check the form", 422, p.error.flatten().fieldErrors));
  // Faster than any human reads a form. Checked before the trap fields are
  // removed, and reported as its own code so a real person who somehow trips it
  // is distinguishable in the logs from a field that failed validation.
  if (p.data.form_started_at && Date.now() - p.data.form_started_at < 1500)
    return next(new AppError("SPAM_REJECTED", "Submission rejected", 422));
  delete p.data.website_url;
  delete p.data.form_started_at;
  req.body = p.data;
  return next();
};

module.exports = {
  apply: mw("apply"),
  openApplication: mw("openApplication"),
  alert: mw("alert"),
  unsubscribe: mw("unsubscribe"),
  schemas,
};
