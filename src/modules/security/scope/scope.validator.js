/**
 * scope validator. Was `validate.passthrough` — no shape checking at all on the
 * organigramme tree, so nothing rejected a bad entity_id, a missing code, or a
 * parent that creates a cycle (audit finding A4). Structural cycles matter more
 * than the usual field hygiene here because the tree is now WALKED:
 * identity-cache.getUserScopeClosure() recurses over parent_scope_id to decide
 * who may act on a scoped approval step. That walk is cycle-safe on its own
 * (UNION discards rows already seen, plus a depth cap), but a cycle would still
 * make the organigramme nonsense to read and to render — so reject it at write
 * time, which is the only place it can be prevented cheaply.
 *
 * The cycle check itself needs the tree and therefore a DB client, so it lives in
 * scope.service.js; this file covers shape only.
 */
"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

const check = (schema) => (req, _res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid request body", 422, r.error.flatten().fieldErrors);
  }
  req.body = r.data;
  return next();
};

// `code` is uppercased on the way in so 'hq' and 'HQ' cannot become two nodes.
// The column is citext with UNIQUE (entity_id, code) and so already treats them
// as one — without this, creating the second raises a bare 23505 instead of the
// tidy conflict the caller expects.
const create = z.object({
  code: z.string().min(1).max(40).transform((s) => s.trim().toUpperCase()),
  name: z.string().min(1).max(160),
  entity_id: z.string().uuid().nullish(),
  parent_scope_id: z.string().uuid().nullish(),
});

// Everything optional on update, but code/name may not be blanked to "".
const update = z.object({
  code: z.string().min(1).max(40).transform((s) => s.trim().toUpperCase()).optional(),
  name: z.string().min(1).max(160).optional(),
  entity_id: z.string().uuid().nullish(),
  parent_scope_id: z.string().uuid().nullish(),
});

// API F-15: POST /scopes/:id/members read `req.body.user_id` unvalidated.
// A non-UUID reached Postgres as 22P02 -> 400 INVALID_VALUE with no fields,
// and an ABSENT user_id inserted NULL or raised 23502 depending on the
// column — two different errors for the same mistake.
const member = z.object({ user_id: z.string().uuid() }).strict();

module.exports = {
  create: check(create), update: check(update), member: check(member),
  schemas: { create, update, member },
};
