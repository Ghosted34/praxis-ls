/**
 * Zod validators for the platform (company dashboard) API.
 */
"use strict";

const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,40}$/, "lowercase [a-z0-9_], starts with a letter");
const onoff = z.enum(["on", "off"]);

const schemas = {
  login: z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }),
  provision: z.object({
    slug,
    name: z.string().min(2),
    plan: z.string().default("full"),
    subdomain: z.string().optional(),
  }),
  feature: z.object({ state: onoff }),
  capacity: z.object({ tier: z.enum(["S", "M", "L", "XL"]) }),
  sandbox: z.object({ days: z.number().int().positive().max(365) }),
};

const validate = (schemaKey) => (req, _res, next) => {
  const parsed = schemas[schemaKey].safeParse(req.body);
  if (!parsed.success) {
    return next(
      new AppError(
        "VALIDATION_ERROR",
        "Invalid request body",
        422,
        parsed.error.flatten().fieldErrors,
      ),
    );
  }
  req.body = parsed.data;
  return next();
};

module.exports = { validate, schemas };
