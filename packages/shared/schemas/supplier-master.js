"use strict";
/**
 * Supplier / partner master payloads.
 *
 * LIFTED from `src/modules/master/supplier_master/supplier_master.validator.js`,
 * which declared its Zod inline while the client's lived in this package — the
 * asymmetry the audit's F12 is about, and the one the "shared schemas are
 * actually shared" gate now forbids. That validator becomes an adapter that
 * imports these, exactly like the client one.
 *
 * SHAPE ONLY, same contract as client-master.js: this decides types, not which
 * fields are mandatory (that is `party_field_config`, applied by
 * `party-config.js`). Service-owned fields — `avl_status`, the scorecard
 * `score_*`, `approved_lanes`, `verification_status`, `compliance_state`,
 * `coa_aux_account`, `hard_block*` — are NOT here: an AVL approval or a
 * verification is a gated transition (Hard Rule 9), not a field a PATCH can set.
 *
 * PAYMENT-METHOD RECONCILIATION (close gap, spec §2.2). The legacy value was
 * `BANK_TRANSFER`; the schema value is `BANK`. This accepts BOTH on input and
 * normalises to `BANK` on output, so an old client, an import, or a hand-built
 * request keeps working and nothing new lands on the retired token.
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

const language = blankToUndefined(z.string().trim().length(2, "Use a 2-letter language code.").toLowerCase());
const nonNegativeRate = blankToUndefined(amount.refine((n) => n >= 0, "Cannot be negative."));
const registrationStatus = z.enum([
  "DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "DEACTIVATED", "ARCHIVED",
]);

/** BANK | BANK_TRANSFER (legacy) | CASH | MOBILE_MONEY | CHEQUE → normalised. */
const paymentMethod = blankToUndefined(
  z
    .enum(["BANK", "BANK_TRANSFER", "CASH", "MOBILE_MONEY", "CHEQUE"])
    .transform((v) => (v === "BANK_TRANSFER" ? "BANK" : v)),
);

const base = {
  entity_id: blankToUndefined(uuid),
  name: requiredText("Supplier name"),
  legal_name: optionalText,
  trading_name: optionalText,
  // Legacy free-text category is preserved for migration continuity; the FK to
  // the supplier_type registry is the new canonical field.
  supplier_type: optionalText,
  supplier_type_id: blankToUndefined(uuid),
  niu: optionalText,
  rccm: optionalText,
  email,
  address: optionalText,
  city: optionalText,
  country_code: countryCode,
  industry: optionalText,
  website: optionalText,
  notes: optionalText,
  evaluation_notes: optionalText,
  risk_tier: optionalText,
  tax_residency_country: countryCode,
  default_currency: blankToUndefined(z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase()),
  default_language: language,
  preferred_channel: optionalText,
  relationship_manager_user_id: blankToUndefined(uuid),
  payment_method: paymentMethod,
  momo_network: optionalText,
  momo_number: optionalText,
  is_non_resident: z.boolean().optional(),
  rating: blankToUndefined(
    z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? v : Number(v)))
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 5, "Rating is 1 to 5."),
  ),
  withholding_rate: nonNegativeRate,
  withholding_certificate_ref: optionalText,
  withholding_certificate_expires_on: optionalDate,
  // Country-first form blocks (PR3-B §2), same contract as the client: the
  // service pulls these out and writes party_registration (+ OHADA NIU/RCCM
  // mirror), supplier_contact and supplier_address rows in one transaction.
  registrations: z.array(partyCommon.registrationCreate).optional(),
  primary_contact: partyCommon.contactCreate.optional(),
  primary_address: partyCommon.addressCreate.optional(),
};

const create = z.object(base);
const update = z.object({
  ...base,
  name: requiredText("Supplier name").optional(),
  is_active: z.boolean().optional(),
  registration_status: registrationStatus.optional(),
});
// AI-facing: supplier_id in the payload → list_suppliers picker.
const aiUpdate = update.extend({ supplier_id: uuid });

// Named `exports.x =` assignments, NOT `module.exports = { x }` — see index.js.
exports.create = create;
exports.update = update;
exports.aiUpdate = aiUpdate;
