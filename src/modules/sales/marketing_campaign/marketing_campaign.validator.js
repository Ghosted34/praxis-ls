"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const rules = require("./marketing_campaign.rules");

const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().min(0).max(1e15);
const count = z.coerce.number().int().min(0).max(1e9);

/**
 * The plan half of a campaign. Split out so `create` and `update` share one
 * definition — the near-universal `{ create, update: create.partial() }` idiom
 * is fine here BECAUSE the lifecycle field is absent from both: `status` is set
 * by the transition/approve/reject paths and by nothing else, so there is no
 * PATCH back-door onto it to close (see requireLifecyclePermissionOnPatch,
 * which this module therefore does not need on its PATCH route).
 */
const planShape = {
  name: z.string().min(1).max(200),
  channel: z.string().max(60).optional().nullable(),
  platform: z.enum(rules.PLATFORMS).optional(),
  target_service: z.string().max(60).optional(),
  owner_user_id: z.string().uuid().optional().nullable(),
  starts_on: d.optional().nullable(),
  ends_on: d.optional().nullable(),
  budget_amount: money.optional(),
  budget_currency: z.string().length(3).optional(),
  remarks: z.string().max(5000).optional().nullable(),
  assets: z.record(z.any()).optional(),
  target_leads: count.optional(),
  target_opportunities: count.optional(),
  target_won: count.optional(),
};

/** The hand-entered half. Never accepted at create — a campaign has produced nothing yet. */
const actualShape = {
  actual_leads: count.optional(),
  actual_opportunities: count.optional(),
  actual_won: count.optional(),
};

const create = z.object(planShape);

/**
 * A patch may carry plan fields, actual fields or both; WHICH are legal in the
 * campaign's current state is `rules.assertEditable` in the service, not this
 * schema. Zod knows the shape of a field, not the state of a row.
 */
const update = z.object({ ...planShape, ...actualShape }).partial();

const schemas = {
  create,
  update,
  transition: z.object({ to: z.enum(["PENDING_APPROVAL", "ACTIVE", "PAUSED", "ENDED"]) }),
  reject: z.object({ reason: z.string().trim().min(1).max(2000) }),
  // AI-facing: campaign_id in the payload → list_campaigns picker.
  aiTransition: z.object({
    campaign_id: z.string().uuid(),
    to: z.enum(["PENDING_APPROVAL", "ACTIVE", "PAUSED", "ENDED"]),
  }),
  aiRecordActuals: z.object({ campaign_id: z.string().uuid(), ...actualShape }),
  send: z.object({ template_id: z.string().uuid() }),
  subscribe: z.object({ email: z.string().email(), name: z.string().optional(), source: z.string().optional() }),
  unsubscribe: z.object({ email: z.string().email() }),
  senderCreate: z.object({ from_name: z.string().min(1), from_address: z.string().email() }),
  templateCreate: z.object({
    name: z.string().min(1),
    subject: z.string().optional().nullable(),
    body_html: z.string().optional().nullable(),
    from_sender_id: z.string().uuid().optional().nullable(),
  }),
  templateUpdate: z.object({
    name: z.string().min(1).optional(),
    subject: z.string().optional().nullable(),
    body_html: z.string().optional().nullable(),
    from_sender_id: z.string().uuid().optional().nullable(),
  }),
};

const mw = (k) => (req, _res, next) => { const p = schemas[k].safeParse(req.body); if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors)); req.body = p.data; return next(); };

module.exports = {
  create: mw("create"), update: mw("update"), transition: mw("transition"), reject: mw("reject"),
  subscribe: mw("subscribe"), unsubscribe: mw("unsubscribe"), send: mw("send"),
  senderCreate: mw("senderCreate"), templateCreate: mw("templateCreate"), templateUpdate: mw("templateUpdate"),
  schemas,
};
