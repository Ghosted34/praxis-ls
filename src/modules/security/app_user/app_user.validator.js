/**
 * Zod validators for app_user: real user-admin schemas (create/update/password/
 * status) + the auth-flow validators (login/refresh/2FA). All security-sensitive
 * input is validated before the controller runs (CONVENTIONS.md).
 */
"use strict";

const { z } = require("zod");
const { passthrough, body: validateBody } = require("../../../shared/http/validate");

/**
 * API F-2. This used to answer `VALIDATION_FAILED` + `details` and bypass the
 * error handler entirely — so these responses also had no `request_id`, which
 * is F-3. Every auth endpoint in the product went through it, meaning the FIRST
 * endpoints any integrator touches taught them the wrong contract.
 *
 * Delegating to the shared kit fixes both: `VALIDATION_ERROR` + `fields` (with
 * `details` still emitted as a deprecated alias by the error handler), and a
 * `request_id` on the response because it now travels through `next(err)`.
 */
const zValidate = (schema) => validateBody(schema);

// `keep_signed_in` MUST be declared: zValidate replaces req.body with the
// parsed object and z.object() strips unknown keys, so an undeclared flag is
// silently dropped before the controller reads it (0494).
const login = zValidate(z.object({ email: z.string().trim().email(), password: z.string().min(1), keep_signed_in: z.boolean().optional() }));
const refresh = zValidate(z.object({ refresh_token: z.string().min(1) }));
const verifyTotp = zValidate(z.object({ pending_token: z.string().min(1), code: z.string().min(6).max(8), keep_signed_in: z.boolean().optional() }));
const totpCode = zValidate(z.object({ code: z.string().min(6).max(8) }));

const schemas = {
  // `password` is optional ONLY because `invite` is the alternative — the
  // service refuses a create that carries neither, with a message that names
  // both. Keeping the either/or in the service rather than as a Zod refinement
  // is deliberate: the password itself is then checked by the full policy
  // (length, complexity, HIBP) in one place, instead of a min(8) here and the
  // real rules somewhere else disagreeing about what is acceptable.
  create: z.object({
    email: z.string().trim().email(),
    full_name: z.string().min(1),
    password: z.string().min(8).optional(),
    invite: z.boolean().optional(),
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
    whatsapp_number: z.string().min(6).max(20).optional().nullable(),
    role_ids: z.array(z.string().uuid()).optional(),
  }),
  password: z.object({ new_password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]) }),
  // AI-facing: user_id in the payload → list_users picker.
  aiUpdate: z.object({ user_id: z.string().uuid(), full_name: z.string().optional(), username: z.string().optional().nullable(), email: z.string().trim().email().optional(), employee_id: z.string().uuid().optional().nullable(), whatsapp_number: z.string().min(6).max(20).optional().nullable(), role_ids: z.array(z.string().uuid()).optional() }),
  aiStatus: z.object({ user_id: z.string().uuid(), status: z.enum(["ACTIVE", "SUSPENDED", "LOCKED"]) }),
};

// Self-service reset. Full strength policy (length/complexity + HIBP) is enforced
// in the service so it can return rich messages and a fail-open breach check; the
// validator only guards the request shape.
const avatar = zValidate(z.object({ data_url: z.string().min(1).max(3_000_000) }));
const forgotPassword = zValidate(z.object({ email: z.string().trim().email() }));
const resetPassword = zValidate(z.object({ token: z.string().min(16), new_password: z.string().min(1) }));
// Signed-in change. `current_password` has no min beyond 1 on purpose: the shape
// check must not hint at the current password's length, and a wrong one fails
// the Argon2id compare in the service either way.
const changePassword = zValidate(z.object({ current_password: z.string().min(1), new_password: z.string().min(1) }));

const signature = zValidate(z.object({ html: z.string().max(20000) }));
const pinRegister = zValidate(z.object({ pin: z.string().regex(/^\d{4,8}$/), label: z.string().max(80).optional().nullable() }));
const pinLogin = zValidate(z.object({ email: z.string().trim().email(), device_id: z.string().uuid(), pin: z.string().regex(/^\d{4,8}$/), keep_signed_in: z.boolean().optional() }));

module.exports = {
  ...passthrough,
  login, refresh, verifyTotp, totpCode, signature, pinRegister, pinLogin,
  avatar, forgotPassword, resetPassword, changePassword,
  create: zValidate(schemas.create),
  update: zValidate(schemas.update),
  password: zValidate(schemas.password),
  status: zValidate(schemas.status),
  schemas,
};
