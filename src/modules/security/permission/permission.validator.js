/**
 * API F-15. `PUT /api/tenant/permissions/grant` writes the RBAC grant matrix —
 * the table that decides who can do what — and had no validator at all.
 *
 * It is not injectable: the repo is SQL-parameterised and coerces the five
 * permission flags with `!!`. The problem is different, and worse in its own
 * way. `role_id` and `module_key` were unchecked, so a non-UUID `role_id`
 * reached Postgres, raised `22P02`, and came back as `400 INVALID_VALUE` — a
 * FOURTH validation-error shape (F-2), arrived at through the database rather
 * than the validator, with no `fields` naming the bad value.
 *
 * The `!!` coercion is its own hazard: `{"can_delete": "false"}` is a truthy
 * string, so a client that sends booleans as strings grants delete when it
 * meant to revoke it. `z.boolean()` rejects that outright instead of quietly
 * turning it into `true`.
 */
"use strict";

const { z } = require("zod");
const { body, passthrough } = require("../../../shared/http/validate");

const grant = z
  .object({
    role_id: z.string().uuid(),
    // "MOD-67" — the shape used everywhere in this codebase.
    module_key: z
      .string()
      .trim()
      .regex(/^MOD-\d{1,4}$/i, "expected a module key like MOD-67"),
    can_create: z.boolean().optional(),
    can_read: z.boolean().optional(),
    can_update: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    can_approve: z.boolean().optional(),
  })
  // No unknown keys: a misspelled `can_aprove` would otherwise be dropped and
  // the grant written as false. On the permission matrix specifically, a
  // silently-dropped flag is a privilege change nobody asked for.
  .strict();

module.exports = { ...passthrough, grant: body(grant), schemas: { grant } };
