"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { STATUSES, ENQUIRY_TYPES } = require("./inbound_intake.rules");

/**
 * Contact enquiry payloads (F9).
 *
 * `internal_notes` is capped at 5000 characters, the legacy's number. The
 * legacy enforces it in PHP only, so the cap holds for its own form and for
 * nothing else that writes to the table; migration 0689 puts the same bound in
 * a CHECK constraint. This copy exists to return a field-named 422 rather than
 * a constraint violation — not to be the only copy.
 */
const text255 = z.string().trim().max(255).optional();
const notes5000 = z.string().trim().max(5000).optional().nullable();
const email = z.string().email().optional().or(z.literal("").transform(() => undefined));

const schemas = {
  /** Public/manual submission. Everything optional but the message body: a
   *  contact form that refuses a half-filled submission loses the enquiry. */
  enquiry: z.object({
    name: text255,
    email,
    phone: text255,
    company_name: text255,
    subject: text255,
    message: z.string().trim().max(20000).optional(),
    source: text255,
    enquiry_type: z.enum(ENQUIRY_TYPES).optional(),
  }),

  /** Classification and notes. NOT status, NOT the triage links — those each
   *  have their own guarded operation (see repo.WRITABLE). */
  update: z.object({
    name: text255,
    email,
    phone: text255,
    company_name: text255,
    subject: text255,
    message: z.string().trim().max(20000).optional(),
    source: text255,
    enquiry_type: z.enum(ENQUIRY_TYPES).optional(),
    internal_notes: notes5000,
  }),

  transition: z.object({ to: z.enum(STATUSES) }),

  /** The reply itself. `body` is required and bounded; an empty "reply" that
   *  flipped the enquiry to RESPONDED would make the tile a lie. */
  respond: z.object({
    body: z.string().trim().min(1).max(20000),
    subject: text255,
  }),

  /** Back-compatible with the pre-F9 body `{to_lead, close}`; `to_partnership`
   *  is the addition. */
  triage: z.object({
    to_lead: z.boolean().optional(),
    to_partnership: z.boolean().optional(),
    close: z.boolean().optional(),
  }),

  // AI-facing variants carry the id in the payload.
  aiTransition: z.object({ contact_enquiry_id: z.string().uuid(), to: z.enum(STATUSES) }),
  aiRespond: z.object({ contact_enquiry_id: z.string().uuid(), body: z.string().trim().min(1).max(20000), subject: text255 }),
  aiTriage: z.object({
    contact_enquiry_id: z.string().uuid(),
    to_lead: z.boolean().optional(),
    to_partnership: z.boolean().optional(),
    close: z.boolean().optional(),
  }),

  // Partnership payloads moved to sales/partnership_request in F10, and their
  // status enum went with them: 0688 replaces REVIEWING / ACCEPTED / DECLINED
  // with the legacy API's own NEW / IN_REVIEW / APPROVED / REJECTED.
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  enquiry: mw("enquiry"),
  update: mw("update"),
  transition: mw("transition"),
  respond: mw("respond"),
  triage: mw("triage"),
  schemas,
};
