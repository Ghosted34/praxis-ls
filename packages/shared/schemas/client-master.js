"use strict";
/**
 * Client master payloads.
 *
 * Lifted in meaning from `src/modules/master/client_master/
 * client_master.validator.js`, which is now the consumer rather than the owner.
 *
 * WHY THIS DOMAIN NEXT. It is the highest-traffic write form in the product —
 * every dossier, invoice and receipt starts from a client record — and it is a
 * pure SHAPE schema with no domain invariants, which makes it the counterpart to
 * the journal entry: that one showed where rules do NOT belong in a schema, this
 * one shows the ordinary case where everything does.
 *
 * THE `optional().or(z.literal(""))` PATTERN, and why it is gone. The original
 * wrote every text field as `z.string().optional().or(z.literal(""))` because a
 * form sends `""` for an untouched input and a bare `.optional()` rejects it.
 * That works, and it stores empty strings in the database — so `email` ends up
 * as `''` rather than NULL, and `WHERE email IS NULL` misses the rows a human
 * would call "no email". `blankToUndefined` below normalises instead: the form
 * may send `""`, and what reaches the API is `undefined`.
 *
 * As with the other domains, the only other change is the MESSAGES. Zod's
 * defaults ("Invalid email") were fine when they were flattened into one banner;
 * the client now renders them under the field, where an operator reads them.
 */
const { z } = require("zod");
const { uuid, requiredText, amount } = require("./common");

/**
 * An optional text field as a FORM sends it: `""` means "not filled in", not
 * "the empty string". Normalising here is what stops empty strings reaching the
 * database, where they are indistinguishable from a deliberate blank.
 */
const blankToUndefined = (schema) =>
  z
    .union([schema, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v));

const email = blankToUndefined(z.string().trim().email("Enter a valid email address."));
const countryCode = blankToUndefined(z.string().trim().length(2, "Use a 2-letter country code.").toUpperCase());

/**
 * Whole days. `z.number().int()` rejects `30.5`, but a form sends a STRING, so
 * this coerces first — and rejects a fractional value rather than silently
 * flooring it, because "45.5 day terms" is a typo, not an instruction.
 */
const wholeDays = blankToUndefined(
  z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "number" ? v : Number(v)))
    .refine((n) => Number.isInteger(n) && n >= 0, "Enter a whole number of days."),
);

const base = {
  entity_id: blankToUndefined(uuid),
  name: requiredText("Client name"),
  client_type_id: blankToUndefined(uuid),
  niu: blankToUndefined(z.string().trim()),
  rccm: blankToUndefined(z.string().trim()),
  email,
  // 0480 — the bill-to address. Required on an OHADA-compliant invoice, and
  // absent from this master until then.
  address: blankToUndefined(z.string().trim()),
  city: blankToUndefined(z.string().trim()),
  country_code: countryCode,
  payment_terms_days: wholeDays,
  credit_limit: blankToUndefined(amount.refine((n) => n >= 0, "Credit limit cannot be negative.")),
  kyc_docs: z.array(z.any()).optional(),
  is_withholding_agent: z.boolean().optional(),
};

const create = z.object(base);
const update = z.object({ ...base, name: requiredText("Client name").optional(), is_active: z.boolean().optional() });
// AI-facing: client_id in the payload → list_clients picker.
const aiUpdate = update.extend({ client_id: uuid });

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.create = create;
exports.update = update;
exports.aiUpdate = aiUpdate;
