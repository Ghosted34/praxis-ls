"use strict";
/**
 * Client master payloads.
 *
 * The consumer of this schema is `src/modules/master/client_master/
 * client_master.validator.js` (an adapter, not the owner) and — for PR 2 — the
 * client's create/edit form. One definition, both sides.
 *
 * SHAPE ONLY. This is a pure shape schema (types + `""`→undefined
 * normalisation); it does NOT decide which fields are mandatory. That is
 * per-tenant policy and lives in `party_field_config`, applied on top of this by
 * `party-config.js` at the API boundary (spec §5.2). The only field this schema
 * hard-requires is `name`, because a nameless client is not a client on any
 * tenant.
 *
 * WHAT IS NOT HERE, deliberately. `verification_status`, `compliance_state`,
 * `avl_status`, `coa_aux_account`, `hard_block*`, `screened_*` are owned by the
 * service and its gated endpoints — a client must not be able to PATCH itself to
 * VERIFIED and walk past the digital-scan gate (Hard Rule 9). `registration_status`
 * IS accepted on update because moving to ACTIVE is what triggers aux-account
 * allocation, and that transition is what the service guards.
 *
 * The blank-normalisation helpers now live in `common.js` so this schema and the
 * supplier one share them; see the note there on the `optional().or("")` pattern
 * this replaced.
 */
const { z } = require("zod");
const {
  uuid,
  requiredText,
  amount,
  blankToUndefined,
  optionalText,
  email,
  countryCode,
  optionalDate,
} = require("./common");
const partyCommon = require("./party-common");

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

const nonNegativeAmount = blankToUndefined(amount.refine((n) => n >= 0, "Cannot be negative."));
const percent = blankToUndefined(amount.refine((n) => n >= 0 && n <= 100, "Enter a percentage between 0 and 100."));
const language = blankToUndefined(z.string().trim().length(2, "Use a 2-letter language code.").toLowerCase());
const registrationStatus = z.enum([
  "DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "DEACTIVATED", "ARCHIVED",
]);

const base = {
  entity_id: blankToUndefined(uuid),
  name: requiredText("Client name"),
  legal_name: optionalText,
  trading_name: optionalText,
  client_type_id: blankToUndefined(uuid),
  niu: optionalText,
  rccm: optionalText,
  email,
  // 0480 — the bill-to address. Required on an OHADA-compliant invoice.
  address: optionalText,
  city: optionalText,
  country_code: countryCode,
  industry: optionalText,
  website: optionalText,
  notes: optionalText,
  risk_tier: optionalText,
  tax_residency_country: countryCode,
  default_currency: blankToUndefined(z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase()),
  default_language: language,
  preferred_channel: optionalText,
  relationship_manager_user_id: blankToUndefined(uuid),
  payment_terms_days: wholeDays,
  credit_limit: nonNegativeAmount,
  credit_insured: z.boolean().optional(),
  credit_insurance_ref: optionalText,
  credit_insurance_expires_on: optionalDate,
  guarantee_amount: nonNegativeAmount,
  deposit_amount: nonNegativeAmount,
  advance_required: z.boolean().optional(),
  advance_required_percent: percent,
  kyc_docs: z.array(z.any()).optional(),
  is_withholding_agent: z.boolean().optional(),
  // Country-first form blocks (PR3-B §2). The service pulls these OUT of the
  // flat payload and writes them as their own rows in the same transaction:
  // `registrations` → party_registration (+ OHADA NIU/RCCM mirrored onto the
  // master), `primary_contact` → client_contact, `primary_address` →
  // client_address. Optional so the plain flat create still works.
  registrations: z.array(partyCommon.registrationCreate).optional(),
  primary_contact: partyCommon.contactCreate.optional(),
  primary_address: partyCommon.addressCreate.optional(),
};

const create = z.object(base);
const update = z.object({
  ...base,
  name: requiredText("Client name").optional(),
  is_active: z.boolean().optional(),
  registration_status: registrationStatus.optional(),
});
// AI-facing: client_id in the payload → list_clients picker.
const aiUpdate = update.extend({ client_id: uuid });

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.create = create;
exports.update = update;
exports.aiUpdate = aiUpdate;
