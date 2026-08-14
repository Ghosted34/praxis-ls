"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/** The HTML date shape, and plain ISO. Anything else is a typo that should be
 *  refused here rather than handed to Postgres to guess at. */
const dateish = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}/, "expected YYYY-MM-DD")
  .transform((v) => v.slice(0, 10))
  .optional()
  .nullable();

const leg = z.object({
  // Accepted and IGNORED: the repo assigns seq from array position, because the
  // array order is what "the itinerary is in this order" means. Declared so a
  // client that round-trips a leg it just read is not rejected for it.
  seq: z.number().optional(),
  itinerary_leg_id: z.string().uuid().optional(),
  leg_type: z.enum(["PICKUP", "MAIN_CARRIAGE", "CUSTOMS", "INLAND_TRANSIT", "WAREHOUSE", "FINAL_DELIVERY", "OTHER"]),
  mode: z.enum(["AIR", "SEA", "LAND", "OTHER"]).default("OTHER"),
  origin: z.string().trim().max(500).optional().nullable(),
  destination: z.string().trim().max(500).optional().nullable(),
  origin_place_id: z.string().uuid().optional().nullable(),
  destination_place_id: z.string().uuid().optional().nullable(),
  planned_departure: dateish,
  planned_arrival: dateish,
  actual_departure: dateish,
  actual_arrival: dateish,
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "BLOCKED", "CANCELLED"]).default("PLANNED"),
  provider_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  is_optional: z.boolean().default(false),
  milestone_instance_id: z.string().uuid().optional().nullable(),
  // TEMPLATE is preserved on a round trip so the editor can keep telling the
  // operator which legs came from the service type. It grants nothing: the
  // required-leg rule reads the template itself, not this field.
  source: z.enum(["TEMPLATE", "MANUAL"]).default("MANUAL"),
});

/**
 * 30 legs is the cap, unchanged from 0672's own bound.
 *
 * Generous — the longest realistic door-to-door file is eight — and bounded,
 * because `replace` is a delete-and-reinsert and an unbounded array is a way to
 * hold a transaction open. A file that genuinely needs more is a file that should
 * be split.
 */
const replaceBody = z.object({ legs: z.array(leg).max(30) });

const replace = (req, _res, next) => {
  const parsed = replaceBody.safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid itinerary", 422, parsed.error.flatten().fieldErrors),
    );
  }
  req.body = parsed.data;
  return next();
};

module.exports = { replace, schemas: { leg, replaceBody } };
