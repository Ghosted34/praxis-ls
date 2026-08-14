"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * The field `key` is the property name a value is stored under in
 * `details_json`, so it is snake_case, immutable after creation (enforced in
 * the service) and must never collide with the envelope keys the dossier write
 * path uses. Reserved words are refused here rather than producing a confusing
 * partial save later.
 */
const RESERVED = new Set(["details", "details_json", "ref", "dossier_id", "status", "service_type_id"]);

const KEY = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "key must be snake_case, e.g. bl_number")
  .refine((k) => !RESERVED.has(k), { message: "that key is reserved" });

/** Mirrors chk_stf_data_type (0660). Kept in step by the test that reads the
 *  migration's CHECK constraint — a vocabulary in two places drifts otherwise. */
const DATA_TYPE = z.enum([
  "TEXT", "TEXTAREA", "NUMBER", "INTEGER", "DATE", "DATETIME", "BOOLEAN",
  "SELECT", "MULTISELECT", "GEO_PLACE", "RATE_PROVIDER", "REF", "CURRENCY",
]);

/** Mirrors chk_stf_facet_role (0660, widened by 0678). This is the vocabulary the
 *  shared panel reads; a role outside it renders nowhere, so it is refused on
 *  write.
 *
 *  ORIGIN/DESTINATION describe the MAIN CARRIAGE — the port pair on the bill of
 *  lading. COLLECTION/FINAL_DELIVERY are the door legs either side of it, and they
 *  are separate roles rather than a second DESTINATION because the facet map is
 *  keyed by role: two DESTINATION fields on one sea import would mean one of them
 *  silently wins. */
const FACET_ROLE = z.enum([
  "TRANSPORT_REF", "CONVEYANCE", "CARRIER", "ORIGIN", "DESTINATION", "ROUTE_VIA",
  "COLLECTION", "FINAL_DELIVERY",
  "DEPARTURE_DATE", "ARRIVAL_DATE",
  "CARGO_DESC", "CARGO_WEIGHT", "CARGO_VOLUME", "CARGO_PACKAGES", "CARGO_MARKS",
  "CUSTODY_LOCATION", "CUSTODY_STATUS", "CUSTODY_IN", "CUSTODY_OUT",
  "INCOTERM", "CUSTOMS_REF", "CUSTOMS_REGIME",
  "SCOPE_SUMMARY", "COUNTERPARTY", "PERIOD_START", "PERIOD_END",
]);

/** Mirrors chk_stf_column_name (0660) — the dossier columns a field may bind
 *  to. Anything else belongs in details_json. */
const COLUMN_NAME = z.enum([
  "pol", "pod", "bl_mawb", "vessel_flight", "incoterm", "customs_regime",
  "eta", "ata", "promised_delivery_date", "rate_provider_id", "title",
  "commodity", "commodity_desc", "gross_weight", "weight_unit",
  "package_count", "volume_cbm", "marks_numbers", "place_receipt", "place_delivery",
]);

const OPTION = z.object({
  value: z.string().min(1),
  label_fr: z.string().min(1),
  label_en: z.string().min(1).optional(),
});

const VALIDATION = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  min_length: z.number().int().nonnegative().optional(),
  max_length: z.number().int().positive().optional(),
  // A NAMED format, never a raw regular expression — see the FORMATS table in
  // shipment_details.service.js for why letting a definition carry its own
  // pattern is regex injection rather than a feature.
  format: z.enum(["EMAIL", "PHONE", "ALPHANUMERIC", "UPPER_CODE", "CONTAINER_NO", "URL"]).optional(),
}).strict();

const fieldBase = {
  group_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(40).optional(),
  group_label_fr: z.string().min(1).max(80).nullable().optional(),
  group_label_en: z.string().min(1).max(80).nullable().optional(),
  group_seq: z.number().int().optional(),
  seq: z.number().optional(),
  label_fr: z.string().min(1).max(120),
  label_en: z.string().min(1).max(120).nullable().optional(),
  help_text_fr: z.string().max(400).nullable().optional(),
  help_text_en: z.string().max(400).nullable().optional(),
  placeholder: z.string().max(120).nullable().optional(),
  data_type: DATA_TYPE.optional(),
  options_json: z.array(OPTION).optional(),
  ref_kind: z.string().max(40).nullable().optional(),
  validation_json: VALIDATION.optional(),
  default_value: z.any().optional(),
  is_required: z.boolean().optional(),
  is_client_visible: z.boolean().optional(),
  is_active: z.boolean().optional(),
  facet_role: FACET_ROLE.nullable().optional(),
  column_name: COLUMN_NAME.nullable().optional(),
  width: z.enum(["THIRD", "HALF", "FULL"]).optional(),
};

/**
 * A SELECT with no options is an empty dropdown — always a mistake, and one
 * that is invisible until someone opens the form. Caught here rather than at
 * render time.
 */
const createField = z.object({ key: KEY, ...fieldBase }).superRefine((v, ctx) => {
  if ((v.data_type === "SELECT" || v.data_type === "MULTISELECT") && !(v.options_json || []).length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options_json"], message: "a SELECT field needs at least one option" });
  }
  if (v.data_type === "REF" && !v.ref_kind) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ref_kind"], message: "a REF field must name the registry it reads (e.g. CONTAINER_TYPE)" });
  }
});

// `key` is accepted on update only so a caller sending the whole row back gets
// a clear "immutable" error from the service instead of a silent no-op.
const updateField = z.object({ key: z.string().optional(), ...fieldBase }).partial();

const createVersion = z.object({
  from: z.string().uuid().optional(),
  name: z.string().min(1).max(120).optional(),
});

/**
 * The two container decisions. Both optional so the UI can flip one without
 * restating the other, and the service COALESCEs whatever is absent.
 */
const containers = z.object({
  captures_containers: z.boolean().optional(),
  container_detail_mode: z.enum(["GROUPED", "PER_BOX"]).optional(),
}).refine((v) => v.captures_containers !== undefined || v.container_detail_mode !== undefined, {
  message: "nothing to change",
});

/**
 * Publishing takes no body — the version is in the URL. `.strict()` rather than
 * no validator at all so a caller that sends `{"version": 5}` is told the field
 * is not accepted, instead of having it silently ignored while the response
 * looks successful. That silent-ignore is the failure mode `assertWritable` in
 * query-helpers was written to stop, and it is worth stopping here too.
 */
const publish = z.object({}).strict();

const schemas = { createField, updateField, createVersion, containers, publish };
const mw = (k) => (req, _res, next) => {
  // `req.body ?? {}` — express.json leaves it undefined for a bodyless POST,
  // and "no body" must read as an empty object, not as a validation failure.
  const p = schemas[k].safeParse(req.body ?? {});
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  createField: mw("createField"),
  updateField: mw("updateField"),
  createVersion: mw("createVersion"),
  containers: mw("containers"),
  publish: mw("publish"),
  schemas,
  DATA_TYPES: DATA_TYPE.options,
  FACET_ROLES: FACET_ROLE.options,
  COLUMN_NAMES: COLUMN_NAME.options,
};
