/**
 * Zod validators for app_user: real user-admin schemas (create/update/password/
 * status) + the auth-flow validators (login/refresh/2FA). All security-sensitive
 * input is validated before the controller runs (CONVENTIONS.md).
 */
"use strict";

const { z } = require("zod");
const { passthrough } = require("../../../shared/http/validate");

function zValidate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: { code: "VALIDATION_FAILED", message: "Invalid request body", details: parsed.error.flatten().fieldErrors },
      });
    }
    req.body = parsed.data;
    return next();
  };
}

const login = zValidate(z.object({ email: z.string().trim().email(), password: z.string().min(1) }));
const refresh = zValidate(z.object({ refresh_token: z.string().min(1) }));
const verifyTotp = zValidate(z.object({ pending_token: z.string().min(1), code: z.string().min(6).max(8) }));
const totpCode = zValidate(z.object({ code: z.string().min(6).max(8) }));

const schemas = {
  create: z.object({
    email: z.string().trim().email(),
    full_name: z.string().min(1),
    password: z.string().min(8),
    username: z.string().optional().nullable(),
    employee_id: z.string().uuid().optional().nullable(),
    status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]).optional(),
    role_ids: z.array(z.string().uuid()).optional(),
  }),
  update: z.object({
    full_name: z.string().optional(),
    username: z.string().optional().nullable(),
    email: z.string().trim().email().optional(),
    employee_id: z.string().uuid().optional().nullable(),
    role_ids: z.array(z.string().uuid()).optional(),
  }),
  password: z.object({ new_password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]) }),
};

const signature = zValidate(z.object({ html: z.string().max(20000) }));
const pinRegister = zValidate(z.object({ pin: z.string().regex(/^\d{4,8}$/), label: z.string().max(80).optional().nullable() }));
const pinLogin = zValidate(z.object({ email: z.string().trim().email(), device_id: z.string().uuid(), pin: z.string().regex(/^\d{4,8}$/) }));

module.exports = {
  ...passthrough,
  login, refresh, verifyTotp, totpCode, signature, pinRegister, pinLogin,
  create: zValidate(schemas.create),
  update: zValidate(schemas.update),
  password: zValidate(schemas.password),
  status: zValidate(schemas.status),
  schemas,
};
