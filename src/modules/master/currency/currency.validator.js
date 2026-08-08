"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const code3 = z.string().trim().toUpperCase().length(3);

const setRate = z.object({
  base: code3,
  quote: code3,
  rate: z.number().positive(),
  as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Add from the ISO-4217 catalogue. The client sends the catalogue values; the
// server trusts nothing about length/shape and re-validates them here.
const addCurrency = z.object({
  code: code3,
  name: z.string().trim().min(1).max(120),
  symbol: z.string().trim().max(16).optional().nullable(),
  decimals: z.number().int().min(0).max(6).optional(),
});

const editCurrency = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    symbol: z.string().trim().max(16).optional().nullable(),
    decimals: z.number().int().min(0).max(6).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

const setBase = z.object({ code: code3 });

const schemas = { setRate, addCurrency, editCurrency, setBase };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  setRate: mw("setRate"),
  addCurrency: mw("addCurrency"),
  editCurrency: mw("editCurrency"),
  setBase: mw("setBase"),
  schemas,
};
