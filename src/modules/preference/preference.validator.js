/**
 * Zod validator for the per-user appearance body.
 *
 * `.nullable()` is load-bearing: null is the documented way to clear an
 * override and inherit the tenant value, so it must survive validation rather
 * than being rejected as a missing string. `.optional()` alongside it is what
 * makes the PUT a partial update — an absent key is untouched, a null key is
 * deleted, and the two are not the same request.
 */
"use strict";

const { z } = require("zod");

const font = z.string().max(200).nullable().optional();

const appearance = z.object({
  fontDisplay: font,
  fontBody: font,
  fontMono: font,
});

function validateAppearance(req, res, next) {
  const parsed = appearance.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: parsed.error.flatten().fieldErrors,
      },
    });
  }
  // The service distinguishes "absent" (leave alone) from "null" (delete) by
  // key presence, so guarantee the invariant it relies on rather than inheriting
  // it: any key whose parsed value is undefined is stripped here.
  req.body = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  return next();
}

module.exports = { validateAppearance };
