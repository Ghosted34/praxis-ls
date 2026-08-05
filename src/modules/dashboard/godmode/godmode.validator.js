/**
 * SEC H3 guard. `POST /godmode/purge` is the CEO hard-delete console — it takes
 * a soft_delete id and a God-Mode PIN and destroys the row for good — and it
 * had no validator at all. The PIN went from an unvalidated body straight into
 * a comparison, and `soft_delete_id` reached the service as whatever type the
 * caller sent.
 *
 * `.strict()` matters more here than almost anywhere: an unrecognised key on
 * the purge endpoint should stop the request, not be ignored.
 */
"use strict";

const { z } = require("zod");
const { body, passthrough } = require("../../../shared/http/validate");

const purge = z
  .object({
    soft_delete_id: z.string().uuid(),
    // Bounded, not shaped: the PIN format is the identity module's business,
    // and duplicating the rule here would create a second place to change it.
    // What this stops is an unbounded string, or a non-string that makes the
    // comparison behave in ways nobody intended.
    pin: z.string().min(4).max(128),
  })
  .strict();

module.exports = { ...passthrough, purge: body(purge), schemas: { purge } };
