"use strict";
/**
 * Nested master-data resources shared by BOTH masters.
 *
 * A client and a supplier carry the identical shape of contact, address, bank
 * account, document, registration and beneficial owner — the two masters stay
 * separate rows (Hard Rule 1), but the body a form posts to
 * `/clients/:id/contacts` and `/suppliers/:id/contacts` is the same, so it is
 * defined once here. The parent id comes from the ROUTE, never the body, so none
 * of these carry `client_id`/`supplier_id`.
 *
 * Every field an operator can set is here; fields the SERVICE owns — verification
 * state, `verified_by`, `scan_status` transitions, `content_hash`, immutable
 * ledger — are deliberately absent, so a request cannot assert them (mass-
 * assignment is closed both by this schema and by the repo allow-list).
 *
 * Named `exports.x =`, not an object literal — the client bundles this and
 * cjs-module-lexer cannot see named exports through the latter. See index.js.
 */
const { z } = require("zod");
const {
  uuid,
  requiredText,
  optionalText,
  email,
  phone,
  countryCode,
  currency,
  optionalDate,
  optionalPercent,
  blankToUndefined,
} = require("./common");

const optionalCurrency = blankToUndefined(currency);
const roleTag = z.enum([
  "BILLING", "OPERATIONS", "CUSTOMS", "LEGAL", "EMERGENCY", "PORTAL_ADMIN",
  "ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE",
]);
const addressType = z.enum([
  "REGISTERED", "BILLING", "DELIVERY", "PICKUP", "WAREHOUSE", "REMITTANCE", "NOTIFY",
]);

/** A partial made optional field-by-field — the PATCH shape of any create schema. */
const patchOf = (shape) => z.object(shape).partial();

// ── Contact (2.8) ───────────────────────────────────────────────────────────
const contactShape = {
  name: requiredText("Contact name"),
  title: optionalText,
  email,
  phone,
  role_tags: z.array(roleTag).optional(),
  is_primary: z.boolean().optional(),
  language: blankToUndefined(z.string().trim().length(2, "Use a 2-letter language code.").toLowerCase()),
  timezone: optionalText,
  portal_access: z.boolean().optional(),
  is_active: z.boolean().optional(),
};
exports.contactCreate = z.object(contactShape);
exports.contactUpdate = patchOf(contactShape);

// ── Address (2.9) ───────────────────────────────────────────────────────────
const addressShape = {
  line1: optionalText,
  line2: optionalText,
  city: optionalText,
  region: optionalText,
  postal_code: optionalText,
  country_code: countryCode,
  type: blankToUndefined(addressType),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
};
exports.addressCreate = z.object(addressShape);
exports.addressUpdate = patchOf(addressShape);

// ── Bank / payment account (2.10) ───────────────────────────────────────────
// is_verified / verified_by / verified_at are set by the service on the
// maker-checker path, never taken from the body.
const bankShape = {
  beneficiary_name: optionalText,
  bank_name: optionalText,
  branch: optionalText,
  account_number: optionalText,
  iban: optionalText,
  swift_bic: optionalText,
  routing_code: optionalText,
  currency: optionalCurrency,
  momo_network: optionalText,
  momo_number: phone,
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
};
exports.bankCreate = z.object(bankShape);
exports.bankUpdate = patchOf(bankShape);

// ── Document (2.7) ──────────────────────────────────────────────────────────
// A document may be saved paper-only (physical_ref, no vault_id): the digital
// scan is a verification gate, not a creation gate (Hard Rule 9). scan_status /
// verification_status / verified_by transitions are service-owned.
const documentShape = {
  document_type_id: blankToUndefined(uuid),
  document_number: optionalText,
  issuing_authority: optionalText,
  issued_on: optionalDate,
  expires_on: optionalDate,
  vault_id: blankToUndefined(uuid),
  physical_ref: optionalText,
  scan_due_on: optionalDate,
};
exports.documentCreate = z.object(documentShape);
exports.documentUpdate = patchOf(documentShape);

// ── Registration / tax-legal ID (2.4) ───────────────────────────────────────
const registrationShape = {
  country_code: countryCode,
  kind: requiredText("Registration kind"),
  number: optionalText,
  issuing_authority: optionalText,
  issued_on: optionalDate,
  expires_on: optionalDate,
};
exports.registrationCreate = z.object(registrationShape);
exports.registrationUpdate = patchOf(registrationShape);

// ── Beneficial owner (2.11, AML) ────────────────────────────────────────────
const beneficialOwnerShape = {
  full_name: requiredText("Full legal name"),
  date_of_birth: optionalDate,
  nationality: countryCode,
  id_type: optionalText,
  id_number: optionalText,
  ownership_percent: optionalPercent,
  is_pep: z.boolean().optional(),
  notes: optionalText,
  vault_id: blankToUndefined(uuid),
};
exports.beneficialOwnerCreate = z.object(beneficialOwnerShape);
exports.beneficialOwnerUpdate = patchOf(beneficialOwnerShape);

// ── Manual hard block (Hard Rule 3) ─────────────────────────────────────────
// A human applies a HARD_BLOCK with a reason; the reason is mandatory precisely
// because this is the one block a rule can never issue.
exports.blockReason = z.object({ reason: requiredText("A block reason") });

// ── Dedupe check (PR3-C §5.1) ───────────────────────────────────────────────
// The candidate a create form / 360 asks about. All optional — the more it
// carries, the better the match. `bank_last4` is compared server-side only and
// never returned. `exclude_id` drops the record itself when checking on edit.
exports.dedupeCheck = z.object({
  name: optionalText,
  legal_name: optionalText,
  email,
  phone,
  registrations: z.array(z.object({ kind: optionalText, number: optionalText })).optional(),
  bank_last4: z.array(z.string()).optional(),
  exclude_id: blankToUndefined(uuid),
});

// The enum vocabularies, exported so a picker and the API agree on the option
// lists without re-typing them.
exports.ROLE_TAGS = roleTag.options;
exports.ADDRESS_TYPES = addressType.options;
