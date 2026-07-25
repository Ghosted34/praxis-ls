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
  refresh: z.object({ refresh_token: z.string().min(1) }),
  provision: z.object({
    slug,
    name: z.string().min(2),
    plan: z.string().default("full"),
    subdomain: z.string().optional(),
  }),
  plan: z.object({ plan: z.string().min(1) }),
  admin: z.object({
    email: z.string().trim().email(),
    name: z.string().optional(),
    password: z.string().min(8, "at least 8 characters"),
    role: z.string().optional(),
  }),
  feature: z.object({ state: onoff }),
  capacity: z.object({ tier: z.enum(["S", "M", "L", "XL"]) }),
  sandbox: z.object({ days: z.number().int().positive().max(365) }),
  ticketStatus: z.object({
    status: z.enum(["NEW", "TRIAGED", "IN_PROGRESS", "SHIPPED", "DECLINED"]),
  }),
  // Platform users
  userCreate: z.object({
    email: z.string().trim().email(),
    full_name: z.string().optional(),
    password: z.string().min(8, "at least 8 characters"),
    role: z.string().optional(),
  }),
  userUpdate: z.object({
    full_name: z.string().optional(),
    role: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  userPassword: z.object({ password: z.string().min(8, "at least 8 characters") }),
  // Plans
  planCreate: z.object({
    code: z.string().min(2),
    name: z.string().min(2),
    price_setup_xaf: z.number().nonnegative().optional(),
    price_yearly_xaf: z.number().nonnegative().optional(),
  }),
  planUpdate: z.object({
    name: z.string().min(2).optional(),
    price_setup_xaf: z.number().nonnegative().optional(),
    price_yearly_xaf: z.number().nonnegative().optional(),
  }),
  planFeatures: z.object({
    features: z.array(z.object({ feature_key: z.string().min(1), included: z.boolean() })),
  }),
  planDelete: z.object({ replacement: z.string().optional() }),
  // RBAC roles
  roleCreate: z.object({
    code: z.string().min(2),
    name: z.string().min(2),
    capabilities: z.array(z.string()).optional(),
  }),
  rolePerms: z.object({ capabilities: z.array(z.string()) }),
  platformSetting: z.object({
    value: z.record(z.any()).optional(),
    secret: z.string().min(1).max(4000).optional(),
  }),
  vapidGenerate: z.object({ subject: z.string().min(3).optional() }),
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
