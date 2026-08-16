"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const nullableText = z.string().max(5000).optional().nullable();
const line = z.object({ dictionary_item_id: z.string().uuid().optional().nullable(), label: z.string().min(1), qty: z.number().positive().optional(), unit_price: z.number().nonnegative().optional() });
const narrative = z.object({
  section: z.string().min(1), language: z.enum(["EN", "FR"]), body: z.string().optional(),
  sort_order: z.number().int().optional(), raw_client_operations: nullableText,
  raw_pain_points: nullableText, raw_proposed_strategy: nullableText, raw_tone: nullableText,
});
const header = {
  title: z.string().min(1).max(500), lead_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(), opportunity_id: z.string().uuid().optional().nullable(),
  language: z.enum(["EN", "FR", "BILINGUAL"]).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  service_category: nullableText, incoterm: nullableText, origin_location: nullableText,
  destination_location: nullableText, cargo_description: nullableText,
  estimated_weight: z.number().nonnegative().optional().nullable(), project_cargo_flag: z.boolean().optional(),
  customs_clearance_target: nullableText, transit_time_target: nullableText,
  free_days_demurrage: z.number().int().nonnegative().optional().nullable(), payment_conditions: nullableText,
  validity_days: z.number().int().positive().optional(), converted_client_id: z.string().uuid().optional().nullable(),
};
const schemas = {
  create: z.object({ ...header, lines: z.array(line).optional(), narratives: z.array(narrative).optional() }),
  update: z.object({ ...header, title: z.string().min(1).max(500).optional(), lines: z.array(line).optional(), narratives: z.array(narrative).optional() }),
  transition: z.object({ to: z.enum(["IN_REVIEW", "SENT", "DRAFT", "REJECTED"]), entity_id: z.string().uuid().optional().nullable() }),
  accept: z.object({ create_quotation: z.boolean().optional(), entity_id: z.string().uuid().optional().nullable() }),
  aiTransition: z.object({ proposal_id: z.string().uuid(), to: z.enum(["IN_REVIEW", "SENT", "DRAFT", "REJECTED"]), entity_id: z.string().uuid().optional().nullable() }),
  aiAccept: z.object({ proposal_id: z.string().uuid(), create_quotation: z.boolean().optional(), entity_id: z.string().uuid().optional().nullable() }),
};
const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), transition: mw("transition"), accept: mw("accept"), schemas };
