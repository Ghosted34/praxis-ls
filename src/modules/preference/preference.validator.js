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

/**
 * The shell arrangement. `railPins` and `towerPins` are bounded on BOTH axes
 * because they are the fields here a client could grow without limit: the rail
 * is a strip of icons roughly a dozen tall and the Control Tower shortcuts
 * grid is capped at eleven user-chosen cards, so a request carrying two
 * hundred is not a preference, and the row it would write is billed to the
 * tenant's database rather than to whoever sent it. The keys are opaque to the
 * server (the client owns which shortcut a key names), so length is the only
 * check worth making — an allow-list here would mean redeploying the API to
 * add a shortcut.
 *
 * Both pin arrays use the same envelope on purpose: one shape, two audiences,
 * so the client's "absent = untouched, null = cleared" rule reads identically
 * on the two lists.
 */
const shell = z.object({
  ribbonPinned: z.boolean().nullable().optional(),
  railPins: z.array(z.string().min(1).max(64)).max(16).nullable().optional(),
  towerPins: z.array(z.string().min(1).max(64)).max(16).nullable().optional(),
  railHintSeen: z.boolean().nullable().optional(),
});

/** Parse, reject, and strip absent keys — the shape the services rely on. */
function validate(schema) {
  return function validateBody(req, res, next) {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    // The services distinguish "absent" (leave alone) from "null" (delete) by
    // key presence, so guarantee the invariant they rely on rather than
    // inheriting it: any key whose parsed value is undefined is stripped here.
    req.body = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    return next();
  };
}

const validateAppearance = validate(appearance);
const validateShell = validate(shell);

module.exports = { validateAppearance, validateShell };
