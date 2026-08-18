"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const iso = z.string().datetime({ offset: true }).or(z.string().min(10));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const create = z.object({
  title: z.string().min(1),
  description: z.string().max(4000).optional().nullable(),
  // 0702: a session has a time, not just a day. `scheduled_on` is still
  // accepted so a caller written against 0360 keeps working — the service
  // derives it from starts_at, so sending both is harmless and sending only
  // the old one still books a session.
  starts_at: iso.optional().nullable(),
  ends_at: iso.optional().nullable(),
  scheduled_on: z.string().optional().nullable(),
  mode: z.enum(["IN_PERSON", "ONLINE", "HYBRID"]).optional(),
  location: z.string().max(300).optional().nullable(),
  join_url: z.string().url().max(1000).optional().nullable(),
  capacity: z.number().int().positive().max(10000).optional().nullable(),
  facilitator: z.string().max(200).optional().nullable(),
  facilitator_employee_id: z.string().uuid().optional().nullable(),
  training_requirement_id: z.string().uuid().optional().nullable(),
  status: z.enum(["SCHEDULED", "LIVE", "DONE", "CANCELLED"]).optional(),
});

const status = z.object({ status: z.enum(["SCHEDULED", "LIVE", "DONE", "CANCELLED"]) });

// `employee_id` is REQUIRED on create. It was optional, which let a roster
// collect rows attached to nobody: they counted towards capacity, rendered as
// blank lines, and could never satisfy a requirement. The partial() update
// schema below keeps it optional, because a PATCH that only ticks `attended`
// must not have to resend it.
const attendee = z.object({
  employee_id: z.string().uuid(),
  attended: z.boolean().optional(),
  certificate_vault_id: z.string().uuid().optional().nullable(),
  certificate_issued_on: ymd.optional().nullable(),
  certificate_expires_on: ymd.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const presence = z.object({ employee_id: z.string().uuid() });

const note = z.object({
  body: z.string().min(1).max(20000),
  is_minutes: z.boolean().optional(),
});

/**
 * One ~30s chunk of live dictation (10708). Same cap as the vacancy intake's
 * transcribe — ~2.8 MB of base64 is a couple of minutes of Opus, comfortably
 * more than one recorder slice, and small enough that a stalled upload is not
 * a hung browser tab. The cap is the cheap outer bound: it stops a large blob
 * being base64-decoded into memory before anything looks at it.
 */
const dictate = z.object({
  audio_data_url: z.string().min(32).max(2_800_000),
});

const requirement = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  department: z.string().max(120).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  valid_months: z.number().int().positive().max(240).optional().nullable(),
  warn_days: z.number().int().min(0).max(365).optional(),
  is_mandatory: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const schemas = {
  create,
  update: create.partial(),
  status,
  attendee,
  attendeeUpdate: attendee.partial(),
  presence,
  note,
  dictate,
  requirement,
  requirementUpdate: requirement.partial(),
};

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
  attendee: mw("attendee"),
  attendeeUpdate: mw("attendeeUpdate"),
  presence: mw("presence"),
  note: mw("note"),
  dictate: mw("dictate"),
  requirement: mw("requirement"),
  requirementUpdate: mw("requirementUpdate"),
  schemas,
};
