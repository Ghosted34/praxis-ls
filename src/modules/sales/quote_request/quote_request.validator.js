"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { STATUSES } = require("./quote_request.rules");

const INTAKE_CHANNEL = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];
const WAREHOUSE_DURATION = [
  "LESS_THAN_7_DAYS",
  "DAYS_7_TO_14",
  "DAYS_15_TO_30",
  "OVER_30_DAYS",
  "UNKNOWN",
];

/**
 * Quote request (MOD-20-intake) payloads.
 *
 * The `incoterm` field is required at the validator level (the legacy drawer
 * marked it required; we keep that). Everything else is optional so a
 * partially-filled enquiry still lands. CSV-style text bounds match the
 * legacy `internal_notes` cap (5000 chars) on the contact_enquiry analogue,
 * applied here to `cargo_description` since the two are the operator-facing
 * free-text fields.
 */
const text255 = z.string().trim().max(255).optional();
const text5000 = z.string().trim().max(5000).optional();

const base = {
  lead_id: z.string().uuid().optional().nullable(),
  intake_channel: z.enum(INTAKE_CHANNEL).optional(),
  requester_name: text255,
  requester_company: text255,
  requester_email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  requester_phone: text255,
  service_category: text255,
  service_type: text255,
  origin_location: text255,
  destination_location: text255,
  warehouse_location: text255,
  warehouse_duration: z.enum(WAREHOUSE_DURATION).optional().nullable(),
  estimated_weight: z.number().nonnegative().optional().nullable(),
  project_cargo_flag: z.boolean().optional(),
  cargo_description: text5000,
  incoterm: text255,
  owner_user_id: z.string().uuid().optional().nullable(),
};

const schemas = {
  create: z.object({ ...base, incoterm: z.string().min(1) }),
  update: z.object({ ...base }),
  transition: z.object({ to: z.enum(STATUSES) }),
  convertToOpportunity: z.object({
    opportunity: z.object({
      name: z.string().min(1),
      estimated_value: z.number().nonnegative().optional().nullable(),
      currency: z.string().length(3).optional(),
      owner_user_id: z.string().uuid().optional().nullable(),
    }),
  }),
  // AI-facing variants carry quote_request_id in the payload.
  aiTransition: z.object({ quote_request_id: z.string().uuid(), to: z.enum(STATUSES) }),
  aiConvert: z.object({ quote_request_id: z.string().uuid(), opportunity: z.object({
    name: z.string().min(1),
    estimated_value: z.number().nonnegative().optional().nullable(),
    currency: z.string().length(3).optional(),
    owner_user_id: z.string().uuid().optional().nullable(),
  }) }),
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
  transition: mw("transition"),
  convertToOpportunity: mw("convertToOpportunity"),
  schemas,
  INTAKE_CHANNEL,
  WAREHOUSE_DURATION,
};
