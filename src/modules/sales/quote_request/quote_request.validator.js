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
  // Which corporate entity the enquiry belongs to. Optional: the service
  // resolves it from the linked lead, or from the tenant's only active
  // entity, and 422s naming this field when a tenant has several.
  entity_id: z.string().uuid().optional().nullable(),
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
  additional_notes: text5000,
  incoterm: text255,
  owner_user_id: z.string().uuid().optional().nullable(),
  // origin_place_id / destination_place_id / attachment_doc_id are in the
  // repo's WRITABLE list but deliberately NOT here. They are written by
  // public_intake.service, which earns them: the coordinates come from
  // re-querying the provider and the document from the vault's own sniffing
  // write. A PATCH that could set attachment_doc_id to any uuid would let a
  // staff user hang any document in the vault off any quote request, which is
  // not an edit anybody has asked for and is the shape of an IDOR.
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
  /**
   * An attachment upload. `file` is a base64 data URL; the vault sniffs the
   * bytes and enforces the type and size ceilings, so this only bounds what is
   * cheap to bound here — a 15 MB base64 string is ~11 MB of file, comfortably
   * above the vault's 10 MB limit, and rejecting it before decoding keeps a
   * hostile payload from being buffered.
   */
  attachment: z.object({
    file: z.string().min(1).max(15 * 1024 * 1024).regex(/^data:[^;]+;base64,/, "expected a base64 data URL"),
    filename: z.string().trim().max(255).optional().nullable(),
    kind: z.enum(["PRIMARY", "ADDITIONAL"]).optional(),
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
  attachment: mw("attachment"),
  schemas,
  INTAKE_CHANNEL,
  WAREHOUSE_DURATION,
};
