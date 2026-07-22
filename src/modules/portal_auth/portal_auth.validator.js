"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const schemas = {
  login: z.object({ email: z.string().email(), password: z.string().min(1) }),
  create: z.object({ email: z.string().email(), password: z.string().min(8), full_name: z.string().optional() }),
  password: z.object({ password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { login: mw("login"), create: mw("create"), password: mw("password"), status: mw("status") };
