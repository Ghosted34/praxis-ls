"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const STATES = ["AVAILABLE", "QA_HOLD", "ALLOCATED", "DISPATCHED", "DAMAGED"];
const KINDS = ["INBOUND", "PUTAWAY", "PICK", "PACK", "DISPATCH", "ADJUST", "COUNT"];

const create = z.object({
  sku: z.string().optional(),
  description: z.string().min(1),
  owner_client_id: z.string().uuid().optional(),
  dossier_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  qty_on_hand: z.number().optional(),
  uom: z.string().optional(),
  state: z.enum(STATES).optional(),
  is_own_stock: z.boolean().optional(),
});
const state = z.object({ state: z.enum(STATES) });
const move = z.object({
  movement_kind: z.enum(KINDS),
  qty: z.number(), // signed delta applied to qty_on_hand
  from_location: z.string().uuid().optional(),
  to_location: z.string().uuid().optional(),
});
const schemas = { create, update: create.partial(), state, move };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), state: mw("state"), move: mw("move"), schemas };
