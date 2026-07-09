/**
 * passthrough create/update (generic CRUD, no strict schema yet) + real Zod
 * validators for login/refresh — login is security-sensitive input, worth
 * doing properly (CONVENTIONS.md: "Validator guards input with Zod before
 * the controller runs").
 */
"use strict";

const { z } = require("zod");
const { passthrough } = require("../../../shared/http/validate");

function zValidate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    req.body = parsed.data;
    return next();
  };
}

const login = zValidate(
  z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }),
);

const refresh = zValidate(
  z.object({
    refresh_token: z.string().min(1),
  }),
);

const verifyTotp = zValidate(
  z.object({
    pending_token: z.string().min(1),
    code: z.string().min(6).max(8),
  }),
);

const totpCode = zValidate(
  z.object({
    code: z.string().min(6).max(8),
  }),
);

module.exports = { ...passthrough, login, refresh, verifyTotp, totpCode };
