"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const rules = require("./transit_order.rules");

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)");

/**
 * A cargo line. `label` is REQUIRED and `inventory_item_id` is optional, which
 * is the inverse of what the code used to assume.
 *
 * G23: the service filtered on `inventory_item_id` while the validator marked it
 * optional, so `{ label: "30 sacs ciment", packages: 30 }` validated, returned
 * 201, and stored nothing. A forwarding order's cargo is a written description
 * far more often than a catalogue item — the catalogue is for warehoused stock —
 * so the free-text case is the NORMAL one and it is the one that was broken.
 */
const line = z.object({
  inventory_item_id: uuid.optional().nullable(),
  label: z.string().trim().min(1, "a description is required").max(500),
  marks: z.string().max(200).optional().nullable(),
  hs_code: z.string().max(30).optional().nullable(),
  packages: z.number().nonnegative().optional(),
  weight: z.string().max(60).optional().nullable(),
  value_amount: z.number().nonnegative().optional().nullable(),
});

/** Accepts "INVOICE" or { code, note } — rules.normaliseDocs decides validity. */
const submittedDoc = z.union([
  z.string().min(1).max(60),
  z.object({ code: z.string().min(1).max(60), note: z.string().max(200).optional() }),
]);

const headFields = {
  entity_id: uuid.optional().nullable(),
  dossier_id: uuid.optional().nullable(),
  customs_regime: z.enum(rules.CUSTOMS_REGIMES).optional().nullable(),
  customs_regime_other: z.string().trim().max(60).optional().nullable(),
  service_direction: z.enum(rules.DIRECTIONS).optional().nullable(),
  declared_value: z.number().nonnegative().optional().nullable(),
  declared_currency: z.string().length(3).toUpperCase().optional(),
  declared_fx_to_xaf: z.number().positive().optional(),
  insurance_type: z.enum(rules.INSURANCE_TYPES).optional(),
  surveyor_party: z.enum(rules.SURVEYOR_PARTIES).optional(),
  departure_date: isoDate.optional().nullable(),
  instructions: z.string().max(4000).optional().nullable(),
  submitted_docs: z.array(submittedDoc).optional(),
};

/**
 * The regime is stated ONE way. Enforced here as well as by the CHECK
 * constraint, so the caller gets a named field and a sentence rather than a
 * 23514 from Postgres.
 */
const oneRegime = (v, ctx) => {
  if (v.customs_regime && v.customs_regime_other) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customs_regime_other"],
      message: "State either a standard regime or a write-in regime, not both.",
    });
  }
};

const schemas = {
  create: z.object({
    ...headFields,
    lines: z.array(line).optional(),
    allow_duplicate: z.boolean().optional(),
    date: isoDate.optional(),
  }).superRefine(oneRegime),

  update: z.object({
    ...headFields,
    lines: z.array(line).optional().nullable(),
  }).superRefine(oneRegime),

  // The old PATCH body. Kept so existing callers and the AI action keep working.
  updateDocs: z.object({ submitted_docs: z.array(submittedDoc) }),

  issue: z.object({ date: isoDate.optional() }),

  sign: z.object({
    signature_vault_id: uuid.optional().nullable(),
    signed_by_name: z.string().trim().max(160).optional().nullable(),
    signed_at: z.string().optional().nullable(),
  }),

  lodge: z.object({
    declaration_ref: z.string().trim().min(1, "required").max(80),
    lodged_at: z.string().optional().nullable(),
  }),

  cancel: z.object({ reason: z.string().trim().min(1, "required").max(500) }),

  /**
   * The generic transition envelope. `to` is validated against the state
   * vocabulary here so `requireTransitionPermission` — which reads `req.body.to`
   * to pick its gate — can only ever see a known state.
   */
  transition: z.object({
    to: z.enum(["ISSUED", "SIGNED", "LODGED", "CANCELLED"]),
    declaration_ref: z.string().trim().max(80).optional(),
    signature_vault_id: uuid.optional().nullable(),
    signed_by_name: z.string().trim().max(160).optional().nullable(),
    reason: z.string().trim().max(500).optional(),
    date: isoDate.optional(),
  }),

  // AI-facing: the id travels in the payload rather than the path.
  aiUpdate: z.object({
    transit_order_id: uuid,
    submitted_docs: z.array(submittedDoc),
  }),
  aiCreate: z.object({
    ...headFields,
    lines: z.array(line).optional(),
    allow_duplicate: z.boolean().optional(),
  }).superRefine(oneRegime),
  aiIssue: z.object({ transit_order_id: uuid, date: isoDate.optional() }),
  aiLodge: z.object({
    transit_order_id: uuid,
    declaration_ref: z.string().trim().min(1).max(80),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data; return next();
};

module.exports = {
  create: mw("create"),
  update: mw("update"),
  updateDocs: mw("updateDocs"),
  issue: mw("issue"),
  sign: mw("sign"),
  lodge: mw("lodge"),
  cancel: mw("cancel"),
  transition: mw("transition"),
  schemas,
};
