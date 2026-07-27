"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  items: z.array(z.string()).optional(),
});
const addItem = z.object({ label: z.string().min(1) });
const toggle = z.object({ is_done: z.boolean() });
const schemas = { create, addItem, toggle };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), addItem: mw("addItem"), toggle: mw("toggle"), schemas };
