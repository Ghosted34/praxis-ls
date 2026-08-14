"use strict";
const { z } = require("zod");
const leg = z.object({
  seq: z.number().optional(),
  leg_type: z.enum(["PICKUP","MAIN_CARRIAGE","CUSTOMS","INLAND_TRANSIT","WAREHOUSE","FINAL_DELIVERY","OTHER"]),
  mode: z.enum(["AIR","SEA","LAND","OTHER"]).default("OTHER"),
  origin: z.string().trim().max(500).optional().nullable(), destination: z.string().trim().max(500).optional().nullable(),
  origin_place_id: z.string().uuid().optional().nullable(), destination_place_id: z.string().uuid().optional().nullable(),
  planned_departure: z.string().optional().nullable(), planned_arrival: z.string().optional().nullable(),
  status: z.enum(["PLANNED","IN_PROGRESS","COMPLETED","BLOCKED","CANCELLED"]).default("PLANNED"),
  provider_id: z.string().uuid().optional().nullable(), notes: z.string().max(2000).optional().nullable(), is_optional: z.boolean().default(false),
});
const replace = (req, _res, next) => { const p = z.object({ legs: z.array(leg).max(30) }).safeParse(req.body); if (!p.success) return next(new (require("../../../utils/errors").AppError)("VALIDATION_ERROR", "Invalid itinerary", 422, p.error.flatten().fieldErrors)); req.body = p.data; next(); };
module.exports = { replace };
