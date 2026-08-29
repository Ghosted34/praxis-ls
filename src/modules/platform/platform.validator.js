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

/**
 * SEC H6. Platform users and tenant admins were validated as
 * `z.string().min(8)` — no complexity, no breach check — while staff app_user
 * paths have always gone through the real policy.
 *
 * The weakness was inverted relative to privilege: a platform user administers
 * EVERY tenant on the deployment, and a tenant admin created through
 * `POST /tenants/:slug/admin` typically receives the CEO role. Both could hold
 * "password" or "12345678". Combined with the absence of platform-tier 2FA,
 * guessing one was a matter of throughput.
 *
 * This mirrors the SYNCHRONOUS half of shared/security/password-policy so the
 * caller gets an immediate, specific error. The asynchronous half — the HIBP
 * breach check and the email-local-part rule — cannot live in a zod schema and
 * is applied in the services (users.service, provisioning.service). Both halves
 * are needed: this one alone would let a breached-but-complex password through.
 */
const strongPassword = z
  .string()
  .min(12, "at least 12 characters")
  .regex(/[a-z]/, "a lowercase letter")
  .regex(/[A-Z]/, "an uppercase letter")
  .regex(/[0-9]/, "a number")
  .regex(/[^A-Za-z0-9]/, "a symbol");

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
    password: strongPassword,
    role: z.string().optional(),
  }),
  feature: z.object({ state: onoff }),
  capacity: z.object({ tier: z.enum(["S", "M", "L", "XL"]) }),
  // 0 = never auto-wipe (0102). `.positive()` here was the last thing keeping
  // the scheduler's own documented opt-out unreachable.
  sandbox: z.object({ days: z.number().int().min(0).max(365) }),
  // A tenant's additional hosts. `surface` says what the host serves — 'public'
  // is a domain their own clients visit, and must never answer with the staff
  // workspace. The hostname itself is validated in tenants.service, which is
  // also where the platform hosts are refused; doing it there keeps one answer
  // for both the add and the update path.
  domainAdd: z.object({
    host: z.string().trim().min(3).max(253),
    surface: z.enum(["erp", "public"]).default("public"),
  }),
  domainSurface: z.object({
    host: z.string().trim().min(3).max(253),
    surface: z.enum(["erp", "public"]),
  }),
  // Shape only. WHICH prefixes are refused lives in shared/http/public-web-paths.js,
  // beside the route table it has to agree with — duplicating that list here
  // would produce the copy that never gets updated.
  domainBase: z.object({
    host: z.string().trim().min(3).max(253),
    base: z.string().trim().min(1).max(32),
  }),
  ticketStatus: z.object({
    status: z.enum(["NEW", "TRIAGED", "IN_PROGRESS", "SHIPPED", "DECLINED"]),
  }),
  // Platform users
  userCreate: z.object({
    email: z.string().trim().email(),
    full_name: z.string().optional(),
    password: strongPassword,
    role: z.string().optional(),
  }),
  userUpdate: z.object({
    full_name: z.string().optional(),
    role: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
  userPassword: z.object({ password: strongPassword }),
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
  aiVendorSet: z.object({
    api_key: z.string().min(1).optional(),
    display_name: z.string().optional(),
    endpoint_url: z.string().optional(),
    default_model: z.string().optional(),
    current_model: z.string().optional(),
    is_active: z.boolean().optional(),
  }),
};

/**
 * API F-15/F-16. `POST /settings/:section/:key/test` and
 * `POST /ai-vendors/:vendor/test` take their entire input from PATH parameters
 * and validated none of it. Both are `settings.write`-tier actions that send a
 * stored credential to a live third-party provider, so the segment decides
 * which secret leaves the building.
 *
 * The id guard the module loader installs does not help here: these are not
 * `:id`, and they are legitimately text. They need a shape of their own.
 */
const PARAM_SCHEMAS = {
  settingTest: z.object({
    section: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/i, "invalid settings section"),
    key: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/i, "invalid settings key"),
  }),
  aiVendorTest: z.object({
    vendor: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/i, "invalid vendor"),
  }),
};

const validateParams = (schemaKey) => (req, _res, next) => {
  const parsed = PARAM_SCHEMAS[schemaKey].safeParse(req.params);
  if (!parsed.success) {
    return next(
      new AppError("VALIDATION_ERROR", "Invalid path parameters", 422, parsed.error.flatten().fieldErrors),
    );
  }
  return next();
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

module.exports = { validate, validateParams, schemas };
