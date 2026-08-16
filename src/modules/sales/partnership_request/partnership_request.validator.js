"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { STATUSES, TYPES } = require("./partnership_request.rules");

/**
 * Partnership request payloads.
 *
 * EVERY FIELD IS LENGTH-BOUNDED, and that is not tidiness. F13 points the
 * public website at this table, so these bounds are what stands between an
 * anonymous form and an unbounded write — the same reasoning the careers
 * module's apply validator states in full. `internal_notes` carries the
 * legacy's 5000-character cap, which the database also enforces.
 */
const INTAKE_CHANNEL = ["MANUAL", "WEBSITE", "REFERRAL", "CAMPAIGN"];

const text255 = z.string().trim().max(255).optional();
const text5000 = z.string().trim().max(5000).optional();
const email = z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined));

/**
 * The memberships. An array on the API; the repo also accepts the legacy's
 * comma-separated string on the way in, because the website that will post here
 * in F13 is the legacy's form and its field is a text input.
 */
const memberships = z.union([
  z.array(z.string().trim().min(1).max(60)).max(25),
  z.string().max(2000),
]).optional();

const applicant = {
  company_name: z.string().trim().min(1).max(255),
  country_of_origin: text255,
  website: text255,
  contact_name: text255,
  contact_title: text255,
  email,
  contact_phone: text255,
  proposal_type: z.enum(TYPES).optional(),
  intake_channel: z.enum(INTAKE_CHANNEL).optional(),
  network_memberships: memberships,
  proposal_text: text5000,
};

/**
 * The supplier block on approve — the same shape the lead convert drawer uses
 * for a client, and for the same reason: the tenant's field policy decides what
 * a supplier must carry, so the approver supplies it rather than the service
 * inventing defaults. Everything is optional here; `masterConfig.enforceRequired`
 * is the authority on what is actually needed and answers with the field names.
 */
const supplierBlock = z.object({
  entity_id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(255).optional(),
  legal_name: text255,
  country_code: z.string().trim().length(2).optional(),
  email,
  website: text255,
  address: text255,
  city: text255,
  supplier_type: text255,
  supplier_type_id: z.string().uuid().optional().nullable(),
  notes: text5000,
  registrations: z.array(z.object({
    country_code: z.string().trim().length(2).optional(),
    kind: z.string().trim().max(40),
    number: z.string().trim().max(80),
    issuing_authority: text255,
    issued_on: z.string().trim().max(40).optional().nullable(),
    expires_on: z.string().trim().max(40).optional().nullable(),
  })).max(20).optional(),
  primary_contact: z.object({
    name: z.string().trim().min(1).max(255),
    title: text255,
    email,
    phone: text255,
  }).optional(),
  primary_address: z.object({
    line1: text255, line2: text255, city: text255, region: text255,
    postal_code: text255, country_code: z.string().trim().length(2).optional(),
  }).optional(),
}).optional();

const schemas = {
  create: z.object({ ...applicant }),
  update: z.object({ ...applicant, company_name: applicant.company_name.optional(), internal_notes: text5000 }),

  /** Lifecycle moves that are NOT approval. APPROVED is refused by the service. */
  transition: z.object({
    to: z.enum(STATUSES.filter((s) => s !== "APPROVED")),
    reason: text5000,
    notes: text5000,
  }),

  approve: z.object({
    // A vendor registration creates a supplier regardless; this is the agency
    // case, where the approver decides. Default false — see rules.suppliersFor.
    create_supplier: z.boolean().optional(),
    supplier: supplierBlock,
    notes: text5000,
  }),

  reject: z.object({ reason: z.string().trim().min(1).max(5000), notes: text5000 }),

  /**
   * The corporate profile. `file` is a base64 data URL; the vault sniffs the
   * bytes and enforces type and size, so the bound here only stops a hostile
   * payload being buffered before it is decoded — 15 MB of base64 is ~11 MB of
   * file, comfortably over the 10 MB the service allows.
   */
  profile: z.object({
    file: z.string().min(1).max(15 * 1024 * 1024).regex(/^data:[^;]+;base64,/, "expected a base64 data URL"),
    filename: z.string().trim().max(255).optional().nullable(),
  }),

  // AI-facing variants carry the id in the payload (REST takes it from the URL).
  aiTransition: z.object({
    partnership_request_id: z.string().uuid(),
    to: z.enum(STATUSES.filter((s) => s !== "APPROVED")),
    reason: text5000,
  }),
  aiApprove: z.object({
    partnership_request_id: z.string().uuid(),
    create_supplier: z.boolean().optional(),
    supplier: supplierBlock,
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"), update: mw("update"), transition: mw("transition"),
  approve: mw("approve"), reject: mw("reject"), profile: mw("profile"),
  schemas, INTAKE_CHANNEL,
};
