/**
 * Zod gate for `PUT /roles/:id/kpi`. Shape only — meaning is the service's
 * (catalog membership, liveness, and the role's own grants need a read of the
 * permission table, which a validator must not do).
 *
 * THE BODY IS `{ config: … }`, not the arrays at the top level, so that
 * "reset this role's band to the product default" is expressible as
 * `config: null` — the same absent-vs-null contract the user preference PUT
 * uses (`null` deletes, absence is impossible here because the field is what
 * carries the operation). A body of `{}` is a valid write of an EMPTY config:
 * "the row exists, and it says nothing" — which the resolver reads exactly as
 * the role-defaults-empty case it already handles.
 */
"use strict";

const { z } = require("zod");

const idRe = /^[a-z0-9][a-z0-9_]{1,39}$/;
const idList = (max) => z.array(z.string().regex(idRe)).max(max);

const config = z.object({
  /** NULL/absent = "everything the role can read", recomputed at read time —
   *  deliberately NO default, so "absent" does not silently become `[]`, which
   *  means the opposite (an empty, explicit scope). */
  scopeIds: idList(64).nullable().optional(),
  defaultIds: idList(4).default([]),
  lockedIds: idList(4).default([]),
});

const putSchema = z.object({
  config: config.nullable(),
});

function validateKpiConfig(req, res, next) {
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: parsed.error.flatten().fieldErrors,
      },
    });
  }
  // `config` is REQUIRED by the PUT contract (see header); zod's `.nullable()`
  // alone would let an absent key through as undefined.
  if (!("config" in (req.body ?? {}))) {
    return res.status(422).json({
      error: { code: "VALIDATION_FAILED", message: "PUT requires an explicit `config` (use null to reset)" },
    });
  }
  req.body = parsed.data;
  return next();
}

module.exports = { validateKpiConfig };
