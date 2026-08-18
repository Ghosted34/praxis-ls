"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A cargo line is its description (G23). `label` has `min(1)` so a blank one is
 * refused at the edge with a field-keyed 422 rather than reaching the service —
 * the service check stays as a backstop for the AI-action path.
 */
const lineSchema = z.object({
  inventory_item_id: z.string().uuid().optional().nullable(),
  label: z.string().min(1).optional(),
  qty: z.number().nonnegative().optional(),
});

/**
 * Either a pick from the file or a hand-typed box. The XOR is not enforced
 * here — `normaliseContainers` refuses a row that is neither, with an index in
 * the message, which is a better error than Zod can produce for a union.
 */
const containerSchema = z.object({
  dossier_container_unit_id: z.string().uuid().optional().nullable(),
  // 10708 — the GROUPED shape: a container line ("3 × 40' HC") from a file
  // with no per-box numbers yet. Either a unit, a line or a typed number
  // identifies the row; the service checks the combination.
  dossier_container_line_id: z.string().uuid().optional().nullable(),
  container_type_code: z.string().max(60).optional().nullable(),
  qty: z.number().int().positive().max(10000).optional().nullable(),
  container_no: z.string().max(40).optional().nullable(),
  seal_no: z.string().max(40).optional().nullable(),
  gross_weight_kg: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const headerFields = {
  dossier_id: z.string().uuid().optional().nullable(),
  entity_id: z.string().uuid().optional().nullable(),
  consignee: z.string().max(200).optional().nullable(),
  city_zone: z.string().max(120).optional().nullable(),
  contact_person: z.string().max(120).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(60).optional().nullable(),
  delivery_date: z.string().regex(ISO_DATE).optional().nullable(),
};

const schemas = {
  create: z.object({
    ...headerFields,
    lines: z.array(lineSchema).optional(),
    containers: z.array(containerSchema).optional(),
    // Accepted for backward compatibility with the old create contract, which
    // required it; the entity is normally inherited from the file.
    date: z.string().regex(ISO_DATE).optional(),
  }),

  update: z.object({
    ...headerFields,
    reservations: z.string().max(2000).optional().nullable(),
    lines: z.array(lineSchema).optional(),
    containers: z.array(containerSchema).optional(),
  }),

  issue: z.object({}).passthrough(),

  deliver: z.object({
    received_by_name: z.string().min(1, "who received the goods"),
    received_at: z.string().datetime({ offset: true }).optional().nullable(),
    reservations: z.string().max(2000).optional().nullable(),
    signature_vault_id: z.string().uuid().optional().nullable(),
  }),

  cancel: z.object({ reason: z.string().min(1, "a cancellation needs a reason") }),

  transition: z.object({
    to: z.enum(["ISSUED", "DELIVERED", "CANCELLED"]),
    reason: z.string().max(2000).optional().nullable(),
    received_by_name: z.string().min(1).optional().nullable(),
  }),
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
  issue: mw("issue"),
  deliver: mw("deliver"),
  cancel: mw("cancel"),
  transition: mw("transition"),
  schemas,
};
