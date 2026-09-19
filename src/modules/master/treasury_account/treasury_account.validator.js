"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

// The rich account body. Fields are optional at the wire level; the service
// applies category-driven "required" rules (petty needs a custodian, etc.)
// so the same validator serves create and update.
const richFields = {
  label:           z.string().min(1),
  currency:        z.string().length(3).optional(),

  bank_name:       z.string().max(200).optional().nullable(),
  branch:          z.string().max(200).optional().nullable(),
  account_number:  z.string().max(64).optional().nullable(),
  iban:            z.string().max(64).optional().nullable(),
  swift_bic:       z.string().max(32).optional().nullable(),
  routing_code:    z.string().max(64).optional().nullable(),
  holder_name:     z.string().max(200).optional().nullable(),

  opening_balance: z.number().finite().optional(),
  opening_date:    z.string().optional().nullable(),        // YYYY-MM-DD; pg parses
  statement_day:   z.number().int().min(1).max(31).optional().nullable(),

  custodian_user_id: z.string().uuid().optional().nullable(),
  location:        z.string().max(200).optional().nullable(),
  float_limit:     z.number().nonnegative().optional().nullable(),

  momo_number:     z.string().max(64).optional().nullable(),
  momo_till:       z.string().max(64).optional().nullable(),
  momo_agent:      z.string().max(64).optional().nullable(),
  momo_network:    z.string().max(64).optional().nullable(), // legacy free-text
  momo_fee_account: z.string().max(64).optional().nullable(),
};

const schemas = {
  create: z.object({
    entity_id:   z.string().uuid(),
    category_id: z.string().uuid(),
    ...richFields,
  }),
  // Update body cannot change entity, category, or coa_code; those are managed.
  update: z.object({
    ...Object.fromEntries(Object.entries(richFields).map(([k, v]) => [k, v.optional()])),
    label: richFields.label.optional(),
    opening_balance_reason: z.string().max(500).optional().nullable(),
  }),
  setActive: z.object({
    active: z.boolean(),
    force_clear_primary: z.boolean().optional(),
    replacement_account_id: z.string().uuid().optional().nullable(),
  }),

  // AI-facing shapes (id in the payload → picker action).
  aiUpdate: z.object({
    treasury_account_id: z.string().uuid(),
    ...Object.fromEntries(Object.entries(richFields).map(([k, v]) => [k, v.optional()])),
    label: richFields.label.optional(),
  }),
  aiSetActive: z.object({ treasury_account_id: z.string().uuid(), active: z.boolean() }),

  createDocument: z.object({
    document_type: z.enum(["BANK_RIB", "BANK_MANDATE", "KYC_DOCUMENT", "SIGNATURE_CARD", "ACCOUNT_LETTER", "OTHER"]),
    title: z.string().min(1).max(200),
    document_number: z.string().max(100).optional().nullable(),
    vault_id: z.string().uuid().optional().nullable(),
    file_name: z.string().max(255).optional().nullable(),
    file_size: z.number().int().nonnegative().optional().nullable(),
    mime_type: z.string().max(100).optional().nullable(),
    issue_date: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  }),

  createSignatory: z.object({
    user_id: z.string().uuid().optional().nullable(),
    person_id: z.string().uuid().optional().nullable(),
    full_name: z.string().min(1).max(200),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    role_title: z.string().max(100).optional().nullable(),
    signatory_type: z.enum(["PRIMARY", "JOINT"]).optional(),
    rule_type: z.enum(["SINGLE_SIGNATURE", "JOINT_REQUIRED"]).optional(),
    limit_amount: z.number().nonnegative().optional().nullable(),
    currency: z.string().length(3).optional(),
    effective_from: z.string().optional().nullable(),
    effective_to: z.string().optional().nullable(),
    is_active: z.boolean().optional(),
    signature_card_doc_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  }),

  updateSignatory: z.object({
    user_id: z.string().uuid().optional().nullable(),
    person_id: z.string().uuid().optional().nullable(),
    full_name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    role_title: z.string().max(100).optional().nullable(),
    signatory_type: z.enum(["PRIMARY", "JOINT"]).optional(),
    rule_type: z.enum(["SINGLE_SIGNATURE", "JOINT_REQUIRED"]).optional(),
    limit_amount: z.number().nonnegative().optional().nullable(),
    currency: z.string().length(3).optional(),
    effective_from: z.string().optional().nullable(),
    effective_to: z.string().optional().nullable(),
    is_active: z.boolean().optional(),
    signature_card_doc_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
  }),

  gatewayUpsert: z.object({
    provider: z.string().min(1).max(64),
    active: z.boolean().optional(),
    role: z.string().max(64).optional().nullable(),
    credentials: z.union([z.string().min(1).max(8000), z.record(z.any())]).optional(),
  }),
  gatewayActive: z.object({ active: z.boolean() }),
  gatewayRole:   z.object({ role: z.string().min(1).max(64) }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  create: mw("create"), update: mw("update"), setActive: mw("setActive"),
  createDocument: mw("createDocument"),
  createSignatory: mw("createSignatory"), updateSignatory: mw("updateSignatory"),
  gatewayUpsert: mw("gatewayUpsert"), gatewayActive: mw("gatewayActive"), gatewayRole: mw("gatewayRole"),
  schemas,
};
