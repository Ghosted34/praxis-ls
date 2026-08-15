"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * Lead payloads. The F6 hardening adds country/address/NIU/RCCM (the fields
 * Finance re-keyed by hand on every legacy conversion), intake_channel, and
 * the two conversion hints (client_type_hint, payment_terms_days). The
 * convert payload now carries a structured `client` object — staff fill it
 * in the convert drawer, and the service passes it through to
 * clientMaster.create with no silent defaults.
 */
const INTAKE_CHANNEL = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];
const CLIENT_TYPE = ["SHIPPER", "CONSIGNEE", "BOTH", "CARRIER", "AGENT"];

const schemas = {
  create: z.object({
    company_name: z.string().min(1),
    contact_name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    country: z.string().optional(),
    address: z.string().optional(),
    niu: z.string().optional(),
    rccm: z.string().optional(),
    source: z.enum(INTAKE_CHANNEL).optional(),
    intake_channel: z.enum(INTAKE_CHANNEL).optional(),
    service_interest: z.string().optional(),
    client_type_hint: z.enum(CLIENT_TYPE).optional().nullable(),
    payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
    owner_user_id: z.string().uuid().optional().nullable(),
    details: z.record(z.any()).optional(),
  }),

  update: z.object({
    company_name: z.string().optional(),
    contact_name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    country: z.string().optional(),
    address: z.string().optional(),
    niu: z.string().optional(),
    rccm: z.string().optional(),
    source: z.enum(INTAKE_CHANNEL).optional(),
    intake_channel: z.enum(INTAKE_CHANNEL).optional(),
    service_interest: z.string().optional(),
    client_type_hint: z.enum(CLIENT_TYPE).optional().nullable(),
    payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
    owner_user_id: z.string().uuid().optional().nullable(),
  }),

  transition: z.object({ to: z.enum(["CONTACTED", "QUALIFIED", "LOST"]) }),

  /**
   * Convert payload — the F6 fix for the legacy's silent defaults.
   * `client` carries every field the staff member enters in the convert
   * drawer. `client_type` and `payment_terms_days` are explicit and
   * required when not already hinted on the lead. The service no longer
   * hard-codes 'BOTH' / 30 days.
   */
  convert: z.object({
    client: z.object({
      name: z.string().min(1).optional(),
      legal_name: z.string().optional(),
      country_code: z.string().length(2).optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      client_type: z.enum(CLIENT_TYPE),
      payment_terms_days: z.number().int().min(0).max(365),
      niu: z.string().optional(),
      rccm: z.string().optional(),
    }),
  }),

  // AI-facing variants carry lead_id in the payload (REST gets it from the URL).
  // `lead_id` resolves to a list_leads picker in the copilot form.
  aiTransition: z.object({ lead_id: z.string().uuid(), to: z.enum(["CONTACTED", "QUALIFIED", "LOST"]) }),
  aiConvert: z.object({ lead_id: z.string().uuid(), client: z.object({
    name: z.string().min(1).optional(),
    legal_name: z.string().optional(),
    country_code: z.string().length(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    client_type: z.enum(CLIENT_TYPE),
    payment_terms_days: z.number().int().min(0).max(365),
    niu: z.string().optional(),
    rccm: z.string().optional(),
  }) }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), convert: mw("convert"), schemas, INTAKE_CHANNEL, CLIENT_TYPE };
