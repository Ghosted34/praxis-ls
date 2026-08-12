"use strict";
/**
 * Nested resources owned by a CORPORATE ENTITY (MOD-01).
 *
 * The entity master is the third to grow child collections, after client_master
 * and supplier_master got theirs in 0511. Those two share `party-common.js`
 * because a client's contact and a supplier's contact are the same thing said
 * twice. An entity's are NOT: a client's address is where we invoice them, an
 * entity's registered office is a statutory fact printed on our own letterhead,
 * and an entity's "people" carry a cap table that no counterparty has. Same
 * mechanism (`buildResource`), separate meaning, separate schemas.
 *
 * As in party-common, the parent id comes from the ROUTE, never the body — none
 * of these carry an `entity_id`. Fields the SERVICE owns (`verified`,
 * `verified_by`, `verified_at`) are deliberately absent so a request cannot
 * assert a verification it has not earned.
 *
 * Named `exports.x =`, not an object literal — the client bundles this and
 * cjs-module-lexer cannot see named exports through the latter. See index.js.
 */
const { z } = require("zod");
const {
  requiredText,
  optionalText,
  email,
  phone,
  countryCode,
  currency,
  amount,
  optionalDate,
  optionalPercent,
  blankToUndefined,
} = require("./common");

const optionalCurrency = blankToUndefined(currency);
const optionalAmount = blankToUndefined(amount);

/** A partial made optional field-by-field — the PATCH shape of any create schema. */
const patchOf = (shape) => z.object(shape).partial();

// ── Enumerations shared with the migration's CHECK constraints ──────────────
// Kept in step with 0515 by hand. A value here that the database rejects is a
// 500 rather than a 422, so these lists are the ones to change first.
const PERSON_ROLES = [
  "SHAREHOLDER", "DIRECTOR", "OFFICER", "LEGAL_REPRESENTATIVE",
  "AUTHORISED_SIGNATORY", "BENEFICIAL_OWNER", "STATUTORY_AUDITOR", "SECRETARY",
];
const HOLDER_TYPES = ["PERSON", "COMPANY"];
const ADDRESS_TYPES = ["REGISTERED", "TRADING", "BILLING", "REMITTANCE", "MAILING", "WAREHOUSE", "OTHER"];
const ESTABLISHMENT_KINDS = ["HEAD_OFFICE", "OFFICE", "WAREHOUSE", "TERMINAL", "WORKSHOP", "SITE", "AGENCY", "OTHER"];
const RELATIONSHIP_TYPES = [
  "HEADQUARTERS", "SUBSIDIARY", "BRANCH", "REPRESENTATIVE_OFFICE",
  "JOINT_VENTURE", "ASSOCIATE", "SPV",
];
const LIFECYCLE_STATES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "DEACTIVATED", "ARCHIVED"];
const ACCOUNTING_FRAMEWORKS = ["OHADA", "IFRS", "IFRS_SME", "US_GAAP", "FR_PCG", "UK_GAAP", "LOCAL_OTHER"];
const CONTACT_ROLE_TAGS = [
  "BILLING", "OPERATIONS", "CUSTOMS", "LEGAL", "HR", "TREASURY",
  "ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "EMERGENCY", "TAX",
];

// ── Person: shareholder / director / officer / signatory / UBO ──────────────
// One shape for every role because in practice one human holds several. The
// shareholding block is only meaningful for SHAREHOLDER, but it is not split into
// a separate schema: a director who later acquires shares should be an edit, not
// a delete-and-recreate under a different endpoint.
const personShape = {
  role: z.enum(PERSON_ROLES),
  holder_type: z.enum(HOLDER_TYPES).optional(),
  full_name: requiredText("Name"),
  title: optionalText,

  // Natural-person identity (AML/KYC).
  date_of_birth: optionalDate,
  nationality: countryCode,
  country_of_residence: countryCode,
  id_type: optionalText,
  id_number: optionalText,

  // Corporate-holder identity.
  company_registration_number: optionalText,
  company_country: countryCode,
  holder_entity_id: blankToUndefined(z.string().uuid("Must be a valid entity id.")),

  email,
  phone,

  // Shareholding. `share_count` is the substantive figure; `ownership_percent`
  // is carried too because it is what people read, and the service reconciles
  // the two rather than making the operator do arithmetic.
  share_class: optionalText,
  share_count: optionalAmount,
  share_nominal_value: optionalAmount,
  ownership_percent: optionalPercent,
  voting_percent: optionalPercent,

  is_pep: z.boolean().optional(),
  is_primary_contact: z.boolean().optional(),
  signature_limit_amount: optionalAmount,
  signature_limit_currency: optionalCurrency,

  effective_from: optionalDate,
  effective_to: optionalDate,

  employee_id: blankToUndefined(z.string().uuid("Must be a valid employee id.")),
  client_id: blankToUndefined(z.string().uuid("Must be a valid client id.")),
  supplier_id: blankToUndefined(z.string().uuid("Must be a valid supplier id.")),

  notes: optionalText,
  is_active: z.boolean().optional(),
};

/**
 * Cross-field rules the column CHECKs in 0515 cannot express.
 *
 * The holder-shape rule is duplicated from the database on purpose: the CHECK
 * there is the guarantee, this is the readable 422. Without it the operator gets
 * a raw constraint-violation 500 and no idea which field to fix.
 */
const withPersonRules = (schema) =>
  schema
    .refine(
      (v) => !(v.effective_from && v.effective_to) || v.effective_to >= v.effective_from,
      { message: "The end date cannot be before the start date.", path: ["effective_to"] },
    )
    .refine(
      (v) => v.holder_type !== "COMPANY" || (!v.date_of_birth && !v.id_number),
      { message: "A company holder has no date of birth or personal ID — use the registration number.", path: ["holder_type"] },
    )
    .refine(
      (v) => v.holder_type !== "PERSON" || !v.company_registration_number,
      { message: "A natural person has no company registration number.", path: ["company_registration_number"] },
    );

exports.personCreate = withPersonRules(z.object(personShape));
exports.personUpdate = withPersonRules(patchOf(personShape));

// ── Contact ────────────────────────────────────────────────────────────────
const contactShape = {
  name: requiredText("Contact name"),
  title: optionalText,
  email,
  phone,
  role_tags: z.array(z.enum(CONTACT_ROLE_TAGS)).optional(),
  is_primary: z.boolean().optional(),
  language: blankToUndefined(z.string().trim().length(2, "Use a 2-letter language code.").toLowerCase()),
  timezone: optionalText,
  is_active: z.boolean().optional(),
};
exports.contactCreate = z.object(contactShape);
exports.contactUpdate = patchOf(contactShape);

// ── Address ────────────────────────────────────────────────────────────────
const addressShape = {
  type: z.enum(ADDRESS_TYPES).optional(),
  line1: optionalText,
  line2: optionalText,
  city: optionalText,
  region: optionalText,
  postal_code: optionalText,
  country_code: countryCode,
  po_box: optionalText,
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
};
exports.addressCreate = z.object(addressShape);
exports.addressUpdate = patchOf(addressShape);

// ── Registration (the entity's own NIU / RCCM / VAT / EORI / EIN …) ─────────
// `kind` is free text rather than an enum: country_profile declares which
// identifiers each jurisdiction expects, and a tenant expanding into a new
// country must not need a code change to record the identifier it was issued.
const registrationShape = {
  country_code: countryCode,
  kind: requiredText("Registration type"),
  number: optionalText,
  issuing_authority: optionalText,
  issued_on: optionalDate,
  expires_on: optionalDate,
  is_primary: z.boolean().optional(),
  notes: optionalText,
};
const withRegistrationRules = (schema) =>
  schema.refine(
    (v) => !(v.issued_on && v.expires_on) || v.expires_on >= v.issued_on,
    { message: "Expiry cannot be before the issue date.", path: ["expires_on"] },
  );
exports.registrationCreate = withRegistrationRules(z.object(registrationShape));
exports.registrationUpdate = withRegistrationRules(patchOf(registrationShape));

// ── Establishment (a site that is not a separate legal person) ─────────────
const establishmentShape = {
  code: optionalText,
  name: requiredText("Establishment name"),
  kind: z.enum(ESTABLISHMENT_KINDS).optional(),
  country_code: countryCode,
  city: optionalText,
  address_line: optionalText,
  tax_office_ref: optionalText,
  registration_ref: optionalText,
  customs_office: optionalText,
  manager_employee_id: blankToUndefined(z.string().uuid("Must be a valid employee id.")),
  opened_on: optionalDate,
  closed_on: optionalDate,
  is_active: z.boolean().optional(),
};
const withEstablishmentRules = (schema) =>
  schema.refine(
    (v) => !(v.opened_on && v.closed_on) || v.closed_on >= v.opened_on,
    { message: "The closing date cannot be before the opening date.", path: ["closed_on"] },
  );
exports.establishmentCreate = withEstablishmentRules(z.object(establishmentShape));
exports.establishmentUpdate = withEstablishmentRules(patchOf(establishmentShape));

// ── The corporate entity master itself ─────────────────────────────────────
// Lives here rather than in corporate_entity.validator.js because a schema that
// only the API imports is a THIRD definition, not a shared one — the client's
// entity form would re-declare the same field rules and the two would drift.
// `create` and `update` are derived from ONE shape for the same reason: the
// previous pair listed the same fields twice, and a column added to one was
// silently unwritable through the other.
const nullableText = optionalText.nullable();
const nullableCountry = countryCode.nullable();
const nullableCurrency = optionalCurrency.nullable();
const nullableAmount = optionalAmount.nullable();
const nullableDate = optionalDate.nullable();
const nullableUuid = blankToUndefined(z.string().uuid("Must be a valid id.")).nullable();
const logoRef = z.string().optional().nullable();

const masterShape = {
  legal_name: requiredText("Legal name"),
  trading_name: nullableText,
  legal_form: nullableText,
  niu: nullableText,
  rccm: nullableText,
  country_code: countryCode,
  address: nullableText,
  description: nullableText,
  industry: nullableText,
  website: nullableText,
  email: nullableText,
  phone: nullableText,
  headcount: nullableAmount,
  timezone: nullableText,

  incorporation_date: nullableDate,
  incorporation_country: nullableCountry,
  incorporation_place: nullableText,
  dissolution_date: nullableDate,
  share_capital: nullableAmount,
  share_capital_currency: nullableCurrency,
  share_capital_paid_up: nullableAmount,

  bank_block: z.record(z.any()).optional(),
  doc_prefix: optionalText,
  default_language: z.enum(["fr", "en"]).optional(),
  fiscal_year_start_month: blankToUndefined(
    amount.refine((n) => Number.isInteger(n) && n >= 1 && n <= 12, "Pick a month, 1-12."),
  ),
  accounting_framework: z.enum(ACCOUNTING_FRAMEWORKS).optional().nullable(),

  default_currency: nullableCurrency,
  default_tax_jurisdiction_id: nullableUuid,
  payroll_country: nullableCountry,
  numbering_reset: z.enum(["NEVER", "ANNUAL", "MONTHLY"]).optional().nullable(),
  vat_registered: z.boolean().optional().nullable(),

  parent_entity_id: nullableUuid,
  relationship_type: z.enum(RELATIONSHIP_TYPES).optional().nullable(),
  ownership_percent: optionalPercent.nullable(),
  consolidates: z.boolean().optional(),
  is_group_parent: z.boolean().optional(),

  logo_light_ref: logoRef,
  logo_dark_ref: logoRef,
};

/** Dissolution cannot precede incorporation — the one cross-field rule here. */
const withMasterRules = (schema) =>
  schema.refine(
    (v) => !(v.incorporation_date && v.dissolution_date) || v.dissolution_date >= v.incorporation_date,
    { message: "Dissolution cannot be before incorporation.", path: ["dissolution_date"] },
  );

exports.masterCreate = withMasterRules(
  z.object({
    ...masterShape,
    code: requiredText("Code"),
    // A new entity may start as a DRAFT and be completed over several sittings —
    // gathering statutes, certificates and a cap table is not a one-form job.
    registration_status: z.enum(["DRAFT", "PENDING_REVIEW", "ACTIVE"]).optional(),
  }),
);
exports.masterUpdate = withMasterRules(patchOf(masterShape));
exports.logoUpload = z.object({
  data_url: z.string().min(1, "Pick an image."),
  variant: z.enum(["light", "dark"]).optional(),
});
exports.setActive = z.object({ active: z.boolean() });
exports.masterShapeKeys = Object.keys(masterShape);
// ── Administrative document ────────────────────────────────────────────────
// Service-owned state is absent by design: `scan_status` transitions,
// `verification_status`, `verified_by`, `content_hash` and `version_no` are
// asserted by the service after a scan actually arrives, never by the request
// claiming them (0511's Hard Rule 9, carried over).
const documentShape = {
  document_type_id: blankToUndefined(z.string().uuid("Pick a document type.")),
  title: optionalText,
  document_number: optionalText,
  issuing_authority: optionalText,
  issued_on: optionalDate,
  expires_on: optionalDate,
  country_code: countryCode,
  establishment_id: blankToUndefined(z.string().uuid("Must be a valid establishment id.")),
  vault_id: blankToUndefined(z.string().uuid("Must be a valid document id.")),
  physical_ref: optionalText,
  scan_due_on: optionalDate,
  renewal_lead_days: blankToUndefined(
    amount.refine((n) => Number.isInteger(n) && n >= 0 && n <= 365, "Enter 0-365 days."),
  ),
  notes: optionalText,
  is_active: z.boolean().optional(),
};
const withDocumentRules = (schema) =>
  schema.refine(
    (v) => !(v.issued_on && v.expires_on) || v.expires_on >= v.issued_on,
    { message: "Expiry cannot be before the issue date.", path: ["expires_on"] },
  );
exports.documentCreate = withDocumentRules(z.object(documentShape));
exports.documentUpdate = withDocumentRules(patchOf(documentShape));

// ── Tax registration (per entity, per jurisdiction) ────────────────────────
const TAX_KINDS = ["VAT", "INCOME", "WHT", "PAYROLL", "CUSTOMS", "LOCAL", "OTHER"];
const FILING_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL", "BIMONTHLY", "ON_EVENT"];

const taxRegistrationShape = {
  jurisdiction_id: blankToUndefined(z.string().uuid("Must be a valid jurisdiction id.")),
  country_code: z.string().trim().length(2, "Use a 2-letter country code.").toUpperCase(),
  tax_kind: z.enum(TAX_KINDS).optional(),
  tax_number: optionalText,
  regime: optionalText,
  filing_frequency: blankToUndefined(z.enum(FILING_FREQUENCIES)),
  filing_due_day: blankToUndefined(
    amount.refine((n) => Number.isInteger(n) && n >= 1 && n <= 31, "Enter a day of the month, 1-31."),
  ),
  currency: optionalCurrency,
  is_withholding_agent: z.boolean().optional(),
  reverse_charge_applies: z.boolean().optional(),
  registered_on: optionalDate,
  deregistered_on: optionalDate,
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
  filing_portal_url: optionalText,
  responsible_user_id: blankToUndefined(z.string().uuid("Must be a valid user id.")),
  notes: optionalText,
};
const withTaxRules = (schema) =>
  schema
    .refine(
      (v) => !(v.registered_on && v.deregistered_on) || v.deregistered_on >= v.registered_on,
      { message: "Deregistration cannot be before registration.", path: ["deregistered_on"] },
    )
    .refine(
      // A filing day without a frequency has nothing to attach to, and the
      // obligation generator would silently skip it.
      (v) => v.filing_due_day === undefined || v.filing_frequency !== undefined,
      { message: "Choose a filing frequency before setting a due day.", path: ["filing_due_day"] },
    );
exports.taxRegistrationCreate = withTaxRules(z.object(taxRegistrationShape));
exports.taxRegistrationUpdate = withTaxRules(patchOf(taxRegistrationShape));

// ── Letterhead configuration ───────────────────────────────────────────────
const hexColor = blankToUndefined(
  z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #C2703D."),
);
exports.letterheadUpdate = z.object({
  show_legal_form: z.boolean().optional(),
  show_share_capital: z.boolean().optional(),
  show_registered_address: z.boolean().optional(),
  show_registrations: z.boolean().optional(),
  show_contact: z.boolean().optional(),
  show_bank_block: z.boolean().optional(),
  show_establishment: z.boolean().optional(),
  header_note_fr: optionalText.nullable(),
  header_note_en: optionalText.nullable(),
  footer_note_fr: optionalText.nullable(),
  footer_note_en: optionalText.nullable(),
  legal_mentions_fr: optionalText.nullable(),
  legal_mentions_en: optionalText.nullable(),
  brand_color: hexColor.nullable(),
  accent_color: hexColor.nullable(),
  logo_position: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
  paper_size: z.enum(["A4", "LETTER"]).optional(),
  header_height_mm: blankToUndefined(amount.refine((n) => n >= 10 && n <= 120, "Enter 10-120 mm.")).nullable(),
  footer_height_mm: blankToUndefined(amount.refine((n) => n >= 10 && n <= 120, "Enter 10-120 mm.")).nullable(),
  remittance_account_id: blankToUndefined(z.string().uuid("Must be a valid treasury account id.")).nullable(),
});

// ── Working calendar (0650) ────────────────────────────────────────────────
// The hours the milestone engine schedules in. Shared so the entity's calendar
// form and the API validate the same object — a day whose close is not after
// its open, or a calendar with no open day at all, would make every due date
// this entity computes either wrong or unreachable.
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM, e.g. 07:30.");

exports.workingCalendarDay = z
  .object({
    weekday: z.number().int().min(0).max(6),
    opens_at: hhmm,
    closes_at: hhmm,
  })
  .refine((d) => d.closes_at > d.opens_at, {
    message: "Closing time must be after opening time.",
    path: ["closes_at"],
  });

exports.workingCalendarHoliday = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  // Fixed feasts recur on month/day; movable ones (Easter, Eid) carry a real
  // year and must be confirmed each year.
  is_recurring: z.boolean().optional(),
  name_fr: z.string().min(1, "Name the day."),
  name_en: optionalText.nullable(),
  is_system: z.boolean().optional(),
});

exports.workingCalendarSave = z.object({
  timezone: z.string().min(1).optional(),
  name: optionalText.nullable(),
  days: z.array(exports.workingCalendarDay).min(1, "A calendar needs at least one open day.").max(7),
  holidays: z.array(exports.workingCalendarHoliday).max(200).optional(),
});

// ── Entity-level actions ───────────────────────────────────────────────────
exports.setStatus = z.object({
  status: z.enum(LIFECYCLE_STATES),
  reason: optionalText,
});

exports.setStructure = z.object({
  parent_entity_id: blankToUndefined(z.string().uuid("Must be a valid entity id.")).nullable().optional(),
  relationship_type: blankToUndefined(z.enum(RELATIONSHIP_TYPES)).nullable().optional(),
  ownership_percent: optionalPercent.nullable().optional(),
  consolidates: z.boolean().optional(),
  is_group_parent: z.boolean().optional(),
});

// ── AI-facing envelopes ────────────────────────────────────────────────────
// The assistant calls a tool with a flat payload and no route parameter, so the
// entity id travels in the body. Composed here rather than in the API validator
// so the envelope is defined once alongside the schemas it wraps.
// An intersection rather than `.extend()`: masterUpdate and setStatus carry
// `.refine()` cross-field rules, which makes them ZodEffects — those have no
// `.shape` to extend, and reaching for the inner object would drop the refine.
const entityIdField = { entity_id: z.string().uuid("Must be a valid entity id.") };
const withEntityId = (schema) => z.object(entityIdField).and(schema);

exports.aiUpdate = withEntityId(exports.masterUpdate);
exports.aiSetActive = z.object({ ...entityIdField, active: z.boolean() });
exports.aiSetStatus = withEntityId(exports.setStatus);
exports.aiCapTable = z.object({ ...entityIdField, as_of: optionalDate });
// Re-parenting was the one entity mutation with a route, a shared schema and a
// UI but no tool, so the assistant could describe a group structure it had no
// way to correct. `setStructure` carries no `.refine()`, so this could have been
// `.extend()` — the intersection is used anyway to keep all four envelopes the
// same shape, and so adding a cross-field rule to setStructure later does not
// silently drop it here.
exports.aiSetStructure = withEntityId(exports.setStructure);

/**
 * The writable keys of each nested collection, by route segment.
 *
 * Exported for the same reason `masterShapeKeys` is: `client/scripts/check-schemas.mjs`
 * diffs them against the controls the dossier actually renders. Being importable
 * by both sides is not the same as being reachable by a person — this module
 * shipped with `vault_id`, `jurisdiction_id`, `holder_entity_id`, `role_tags`
 * and a dozen others accepted by the API, displayed by the dossier, and settable
 * by nobody. `vault_id` was the sharpest: the service advances a document's
 * `scan_status` from PENDING only when it is set, so no entity document could
 * ever be recorded as scanned.
 *
 * Keyed by URL segment (`tax-registrations`, not `taxRegistrations`) so the
 * gate's failure message names a route a reader can go and look at.
 */
exports.nestedShapeKeys = {
  people: Object.keys(personShape),
  contacts: Object.keys(contactShape),
  addresses: Object.keys(addressShape),
  registrations: Object.keys(registrationShape),
  establishments: Object.keys(establishmentShape),
  documents: Object.keys(documentShape),
  "tax-registrations": Object.keys(taxRegistrationShape),
};

/** The letterhead designer's writable columns. `letterheadUpdate` carries no
 *  `.refine()`, so it is a plain ZodObject and its shape is readable directly. */
exports.letterheadKeys = Object.keys(exports.letterheadUpdate.shape);

exports.PERSON_ROLES = PERSON_ROLES;
exports.HOLDER_TYPES = HOLDER_TYPES;
exports.ADDRESS_TYPES = ADDRESS_TYPES;
exports.ESTABLISHMENT_KINDS = ESTABLISHMENT_KINDS;
exports.RELATIONSHIP_TYPES = RELATIONSHIP_TYPES;
exports.LIFECYCLE_STATES = LIFECYCLE_STATES;
exports.ACCOUNTING_FRAMEWORKS = ACCOUNTING_FRAMEWORKS;
exports.CONTACT_ROLE_TAGS = CONTACT_ROLE_TAGS;
exports.TAX_KINDS = TAX_KINDS;
exports.FILING_FREQUENCIES = FILING_FREQUENCIES;
