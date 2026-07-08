/**
 * Real Zod validators (CONVENTIONS.md: "Validator guards input with Zod
 * before the controller runs"). Most existing modules still use the
 * generic `passthrough` no-op — login is security-sensitive input, worth
 * doing properly from the start.
 */
"use strict";

const { z } = require("zod");

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

module.exports = { login, refresh };
