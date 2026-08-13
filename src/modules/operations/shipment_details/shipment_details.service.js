/**
 * Shared Shipment/Service Detail Component — the service layer.
 *
 * TWO JOBS, and they are the whole point of the module:
 *
 *   1. `applyValues` — the WRITE side. A dossier arrives carrying a bag of
 *      service-specific values keyed by field key. This splits them into the
 *      dossier columns some of them are bound to and the `details_json` the
 *      rest live in, validates every one against its definition, and refuses
 *      the ones that are not defined for this service type. Nothing else in the
 *      codebase is allowed to write `details_json` for a dossier, so there is
 *      exactly one place where "is this a legal value for this field" is
 *      decided.
 *
 *   2. `forDossier` — the READ side. The canonical projection every consumer
 *      binds to: facets (what this file's transport reference / route / cargo
 *      IS, whatever the service type), the rendered groups, the equipment, and
 *      a completeness figure. One shape, twelve service types, and any number
 *      of service types nobody has invented yet.
 *
 * WHY THE WRITE PATH IS STRICT AND THE READ PATH IS FORGIVING. A value that is
 * not defined for the service type is a bug in the caller and is rejected with
 * the field named. But a dossier whose service type has NO field set, or whose
 * set was retired, still reads: `forDossier` degrades to the core columns and
 * an empty facet map rather than throwing. Files must not become unreadable
 * because somebody archived a form.
 */
"use strict";

const repo = require("./shipment_details.repo");
const rules = require("./shipment_details.rules");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

/**
 * The formats a field definition may require, BY NAME.
 *
 * WHY NOT A REGEX ON THE DEFINITION. The first version let a field carry its own
 * `pattern` string and did `new RegExp(pattern).test(value)`. That is regular
 * expression injection (CodeQL js/regex-injection, and it flagged it): the
 * pattern is authored by a tenant admin through the API, so a catastrophically
 * backtracking one — `(a+)+$` against a long value — would hang the save path
 * for everybody on that tenant. Node has no way to time a regex out.
 *
 * It also was not a feature anyone asked for. A named list is what an admin
 * actually wants ("this field is an email"), it cannot be weaponised, every
 * expression is owned and reviewed here, and adding a format is a one-line
 * change with a test rather than a support call.
 *
 * Each is anchored and linear — no nested quantifiers, nothing that can
 * backtrack super-linearly.
 */
const FORMATS = {
  EMAIL: { re: /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/, hint: "an email address" },
  PHONE: { re: /^\+?[0-9 ()-]{6,25}$/, hint: "a phone number" },
  ALPHANUMERIC: { re: /^[A-Za-z0-9]{1,64}$/, hint: "letters and digits only" },
  UPPER_CODE: { re: /^[A-Z0-9_-]{1,40}$/, hint: "an uppercase code (A-Z, 0-9, _ or -)" },
  // ISO 6346, the same shape dossier_container_unit validates a box number by.
  CONTAINER_NO: { re: /^[A-Z]{4}[0-9]{6,7}$/, hint: "a container number like MSKU1234567" },
  URL: { re: /^https?:\/\/[^\s]{3,300}$/, hint: "a URL starting http:// or https://" },
};

/* ── Write side ────────────────────────────────────────────────────────────── */

const isBlank = rules.isBlank;

/** Coerce and check one incoming value against its definition. Returns the
 *  value to store; throws a 422 naming the field when it cannot. */
function coerce(field, value) {
  const label = field.label_en || field.label_fr || field.key;
  const fail = (msg) => {
    throw new AppError("VALIDATION_ERROR", `${label}: ${msg}`, 422, { [field.key]: [msg] });
  };
  if (isBlank(value)) return null;

  const v = field.validation_json || {};

  switch (field.data_type) {
    case "NUMBER":
    case "INTEGER": {
      const n = Number(value);
      if (!Number.isFinite(n)) fail("must be a number");
      if (field.data_type === "INTEGER" && !Number.isInteger(n)) fail("must be a whole number");
      if (v.min !== undefined && n < v.min) fail(`must be at least ${v.min}`);
      if (v.max !== undefined && n > v.max) fail(`must be at most ${v.max}`);
      return n;
    }
    case "BOOLEAN":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      fail("must be true or false");
      return null;
    case "DATE":
    case "DATETIME": {
      const s = String(value);
      // Accept the HTML date/datetime-local shapes and plain ISO; anything else
      // is a typo we should refuse rather than hand to Postgres to guess at.
      if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(s)) {
        fail("must be a date (YYYY-MM-DD)");
      }
      return field.data_type === "DATE" ? s.slice(0, 10) : s;
    }
    case "SELECT": {
      const opts = (field.options_json || []).map((o) => String(o.value));
      if (opts.length && !opts.includes(String(value))) fail(`must be one of: ${opts.join(", ")}`);
      return String(value);
    }
    case "MULTISELECT": {
      const arr = Array.isArray(value) ? value : [value];
      const opts = (field.options_json || []).map((o) => String(o.value));
      for (const x of arr) {
        if (opts.length && !opts.includes(String(x))) fail(`"${x}" is not one of: ${opts.join(", ")}`);
      }
      return arr.map(String);
    }
    case "GEO_PLACE":
    case "RATE_PROVIDER":
    case "REF":
    case "CURRENCY":
      return String(value);
    default: {
      const s = String(value);
      if (v.max_length !== undefined && s.length > v.max_length) {
        fail(`must be at most ${v.max_length} characters`);
      }
      if (v.min_length !== undefined && s.length < v.min_length) {
        fail(`must be at least ${v.min_length} characters`);
      }
      if (v.format) {
        const fmt = FORMATS[v.format];
        // An unknown format is a definition that predates this list (or a typo).
        // Validating as free text is the safe direction to be wrong in: the save
        // succeeds and the definition is the thing to fix.
        if (fmt && !fmt.re.test(s)) fail(`must be ${fmt.hint}`);
      }
      return s;
    }
  }
}

/**
 * Split a bag of field values into a dossier column patch and a details_json
 * object, validating as it goes.
 *
 * @param fields   the active field definitions of the service type's form
 * @param values   { [field key]: value } straight off the request
 * @param opts.existingDetails  merged under the incoming values, so a PATCH
 *                              that sends one field does not wipe the rest
 * @param opts.enforceRequired  true on create; on update a field can be
 *                              cleared temporarily without blocking the save —
 *                              completeness reports it instead
 */
function partition(fields, values, { existingDetails = {}, enforceRequired = false } = {}) {
  const incoming = values || {};
  const columns = {};
  const details = { ...existingDetails };

  /*
   * THE LOOP IS DRIVEN BY THE DEFINITIONS, NOT BY THE REQUEST — and that is a
   * correctness property, not a style choice.
   *
   * The first version iterated `Object.entries(values)` and wrote
   * `details[key] = clean`, where `key` came straight off the request body.
   * CodeQL called that remote property injection (js/remote-property-injection,
   * four high-severity alerts) and it was right: a property NAME taken from a
   * request and used as a write target reaches `Object.prototype` through
   * `__proto__`, and the `byKey.get(key)` guard above it is not something a
   * dataflow analyser can see through — nor should it have to.
   *
   * Iterating the fields instead means every property name written below comes
   * from a `service_type_field` row. An unknown key in the request is still
   * refused (see the check after the loop), but it is only ever reported as a
   * VALUE in a message — never used to index anything.
   */
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field.key)) continue;
    if (field.is_active === false) {
      throw new AppError(
        "RETIRED_FIELD",
        `"${field.key}" has been retired on this service type`,
        422,
        // `field.key` comes from a service_type_field ROW, not from the
        // request, so keying the detail map by it is safe and keeps the form
        // able to show the error against the control it belongs to.
        { [field.key]: ["retired — it can no longer be written"] },
      );
    }
    const clean = coerce(field, incoming[field.key]);
    if (field.column_name) columns[field.column_name] = clean;
    else if (clean === null) delete details[field.key];
    else details[field.key] = clean;
  }

  // Anything sent that this service type does not define. Refused rather than
  // silently dropped — a caller that sends `sea_pol` to a warehousing file has
  // a bug, and a save that looks successful while discarding half the payload
  // is the worst way to find that out.
  const known = new Set(fields.map((f) => f.key));
  const unknown = Object.keys(incoming).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new AppError(
      "UNKNOWN_FIELD",
      `${unknown.map((k) => `"${k}"`).join(", ")} ${unknown.length === 1 ? "is not a field" : "are not fields"} on this service type`,
      422,
      { details: unknown.map((k) => `"${k}" is not defined for this service type`) },
    );
  }

  if (enforceRequired) {
    const missing = fields
      .filter((f) => f.is_required && f.is_active !== false)
      .filter((f) => {
        const v = f.column_name ? columns[f.column_name] : details[f.key];
        return isBlank(v);
      })
      .map((f) => f.key);
    if (missing.length) {
      throw new AppError(
        "MISSING_REQUIRED_FIELDS",
        `This service type requires: ${missing.join(", ")}`,
        422,
        // Definition keys again, so the form can mark each missing control.
        missing.reduce((a, k) => ({ ...a, [k]: ["required for this service type"] }), {}),
      );
    }
  }

  return { columns, details };
}

/**
 * Resolve the form a dossier should be written against, and apply a bag of
 * values to it.
 *
 * `fieldSetId` pins the version: on UPDATE the file keeps the version it was
 * created under, which is the entire reason versions exist — republishing the
 * sea form must not retroactively invalidate two hundred open files.
 *
 * Returns `{ patch, fieldSet }` where `patch` is ready to merge into the
 * dossier write. A service type with no active form yields an empty patch and a
 * null set: that is a normal state, not an error.
 */
async function applyValues(client, { serviceTypeId, fieldSetId = null, values, existingDetails, enforceRequired = false }) {
  const fieldSet = fieldSetId
    ? await repo.fieldSetById(client, fieldSetId)
    : await repo.activeFieldSet(client, serviceTypeId);

  if (!fieldSet) {
    if (values && Object.keys(values).length) {
      throw new AppError(
        "NO_FIELD_SET",
        "This service type has no shipment-detail form yet — define one under Service types → Details.",
        422,
      );
    }
    return { patch: {}, fieldSet: null };
  }

  const fields = await repo.fieldsOf(client, fieldSet.service_type_field_set_id);
  const { columns, details } = partition(fields, values, { existingDetails, enforceRequired });

  const patch = { ...columns };
  patch.details_json = details;
  patch.service_type_field_set_id = fieldSet.service_type_field_set_id;
  return { patch, fieldSet };
}

/* ── Read side ─────────────────────────────────────────────────────────────── */

/**
 * Total TEU and box count across a file's equipment — the two numbers a header
 * strip shows and the extra-charge work will compute on. `teu` comes from the
 * registry's `extra`, so a tenant that adds a container type gets it counted
 * without a code change.
 */
function summariseContainers(lines) {
  let boxes = 0;
  let teu = 0;
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    boxes += qty;
    const t = Number((l.container_type_extra || {}).teu);
    if (Number.isFinite(t)) teu += t * qty;
  }
  return {
    lines: lines.length,
    boxes,
    teu: Math.round(teu * 100) / 100,
    identified: lines.reduce((n, l) => n + (Array.isArray(l.units) ? l.units.length : 0), 0),
  };
}

/**
 * The projection. THIS is what every document, costing, quotation and portal
 * page binds to.
 *
 * `lang` picks the label language; values are language-independent except for
 * SELECT labels and booleans, which are resolved through the field definition.
 *
 * `clientVisibleOnly` is the portal's switch: it drops every field the
 * service-type owner did not mark client-visible, BEFORE facets are composed,
 * so the portal cannot leak an internal contact or a charging basis through the
 * canonical strip.
 */
async function forDossier(client, dossierId, { lang = "en", clientVisibleOnly = false } = {}) {
  const dossier = await repo.dossierFor(client, dossierId);
  if (!dossier) throw new AppError("NOT_FOUND", "Dossier not found", 404);

  // The version the file was created under, falling back to whatever is live
  // for its service type (files predating 0660 have no pinned version).
  const fieldSet =
    (await repo.fieldSetById(client, dossier.service_type_field_set_id)) ||
    (await repo.activeFieldSet(client, dossier.service_type_id));

  let fields = fieldSet ? await repo.fieldsOf(client, fieldSet.service_type_field_set_id) : [];
  if (clientVisibleOnly) fields = fields.filter((f) => f.is_client_visible);

  const details = dossier.details_json || {};
  const resolved = { rate_provider_name: dossier.rate_provider_name };
  const facets = rules.toFacets(fields, dossier, details, { lang, resolved });

  // Groups carry the VALUE alongside each definition, so a consumer rendering
  // the full block does not have to reach back into details_json and re-apply
  // the column/json rule this module exists to own.
  const groups = rules.toGroups(fields.filter((f) => f.is_active !== false), { lang }).map((g) => ({
    ...g,
    fields: g.fields.map((f) => ({
      key: f.key,
      label: lang === "fr" ? f.label_fr : f.label_en || f.label_fr,
      data_type: f.data_type,
      width: f.width,
      facet_role: f.facet_role,
      is_required: f.is_required,
      is_client_visible: f.is_client_visible,
      value: rules.rawValue(f, dossier, details),
      display: rules.displayValue(f, rules.rawValue(f, dossier, details), { lang, resolved }),
    })),
  }));

  const containers = dossier.captures_containers ? await repo.containersFor(client, dossierId) : [];

  return {
    dossier: {
      dossier_id: dossier.dossier_id,
      ref: dossier.ref,
      title: dossier.title,
      status: dossier.status,
      client_id: dossier.client_id,
      client_name: dossier.client_name,
      service_type_id: dossier.service_type_id,
      service_type_key: dossier.service_type_key,
      service_type_name: lang === "fr"
        ? dossier.service_name_fr
        : dossier.service_name_en || dossier.service_name_fr,
    },
    field_set: fieldSet
      ? {
        service_type_field_set_id: fieldSet.service_type_field_set_id,
        version: fieldSet.version,
        is_active: fieldSet.is_active,
        // True when the file is pinned to a version that is no longer live —
        // the 360 shows it so a stale form is visible rather than mysterious.
        is_stale: dossier.service_type_field_set_id
          ? fieldSet.is_active !== true
          : false,
      }
      : null,
    facets,
    facet_order: rules.FACET_ORDER.filter((r) => facets[r]),
    route_label: rules.routeLabel(facets),
    groups,
    containers: {
      enabled: dossier.captures_containers === true,
      mode: dossier.container_detail_mode || "GROUPED",
      lines: containers,
      summary: summariseContainers(containers),
    },
    completeness: rules.completeness(fields, dossier, details),
  };
}

/**
 * The form to render when CREATING a file of a given service type — the
 * definitions with no values yet. Called the moment the user picks a service
 * type, which is the behaviour the whole feature was asked for: choose the
 * service, and the fields you must fill appear.
 */
async function formFor(client, serviceTypeId, { lang = "en" } = {}) {
  const fieldSet = await repo.activeFieldSet(client, serviceTypeId);
  if (!fieldSet) return { field_set: null, groups: [], containers: null };

  const fields = await repo.fieldsOf(client, fieldSet.service_type_field_set_id, { activeOnly: true });
  const { rows } = await client.query(
    "SELECT captures_containers, container_detail_mode FROM service_type WHERE service_type_id = $1",
    [serviceTypeId],
  );
  const st = rows[0] || {};

  return {
    field_set: {
      service_type_field_set_id: fieldSet.service_type_field_set_id,
      version: fieldSet.version,
      name: fieldSet.name,
    },
    groups: rules.toGroups(fields, { lang }).map((g) => ({
      ...g,
      fields: g.fields.map((f) => ({
        key: f.key,
        label: lang === "fr" ? f.label_fr : f.label_en || f.label_fr,
        help: lang === "fr" ? f.help_text_fr : f.help_text_en || f.help_text_fr,
        placeholder: f.placeholder,
        data_type: f.data_type,
        options: f.options_json,
        ref_kind: f.ref_kind,
        validation: f.validation_json,
        default_value: f.default_value,
        is_required: f.is_required,
        is_client_visible: f.is_client_visible,
        facet_role: f.facet_role,
        column_name: f.column_name,
        width: f.width,
      })),
    })),
    containers: {
      enabled: st.captures_containers === true,
      mode: st.container_detail_mode || "GROUPED",
    },
  };
}

/**
 * Freeze a file's shipment details onto a document that is locking (0661).
 *
 * WHY. `forDossier` is computed live, which is right for every screen asking
 * "what do we know now" and wrong for a document that has been approved,
 * issued or posted. A costing approved citing MSC ARUSHI must still cite MSC
 * ARUSHI after the carrier rolls the booking — otherwise an approved record
 * silently rewrites itself, which under OHADA it may not.
 *
 * BEST-EFFORT, AND DELIBERATELY SO. Called from inside a lock transition. A
 * document that FAILED TO BE APPROVED because its details could not be
 * snapshotted would be a worse outcome than one whose snapshot is NULL — and
 * NULL is already a supported state (every pre-0661 document has one, and the
 * readers fall back to the live projection). So this never throws.
 *
 * `table` is code-provided, never request-provided: it is validated against the
 * five documents 0661 actually added the column to, so it can never become an
 * identifier from a payload.
 */
/**
 * The five documents 0661 added the column to, each as a COMPLETE statement
 * rather than a table name to interpolate.
 *
 * Written this way on purpose. A `UPDATE ${table} SET … WHERE ${pk} = $1` is
 * safe here — `table` is code-provided and checked against this map — but it is
 * the same construction `query-helpers` exists to keep out of module code, and
 * it reads as a SQL-injection sink to a human reviewer and a static analyser
 * alike. A lookup of finished statements cannot be got wrong by a later caller,
 * and needs no argument about whether the input is trusted.
 *
 * `AND shipment_details_snapshot IS NULL` makes every one idempotent: a
 * document that has already been frozen is never re-frozen, so a retried
 * transition cannot overwrite what the document said when it first locked.
 */
const SNAPSHOT_SQL = {
  costing:
    "UPDATE costing SET shipment_details_snapshot = $2 WHERE costing_id = $1 AND shipment_details_snapshot IS NULL RETURNING costing_id",
  invoice:
    "UPDATE invoice SET shipment_details_snapshot = $2 WHERE invoice_id = $1 AND shipment_details_snapshot IS NULL RETURNING invoice_id",
  quotation:
    "UPDATE quotation SET shipment_details_snapshot = $2 WHERE quotation_id = $1 AND shipment_details_snapshot IS NULL RETURNING quotation_id",
  transit_order:
    "UPDATE transit_order SET shipment_details_snapshot = $2 WHERE transit_order_id = $1 AND shipment_details_snapshot IS NULL RETURNING transit_order_id",
  delivery_note:
    "UPDATE delivery_note SET shipment_details_snapshot = $2 WHERE delivery_note_id = $1 AND shipment_details_snapshot IS NULL RETURNING delivery_note_id",
};

async function snapshotOnto(client, { table, id, dossierId }) {
  const sql = Object.prototype.hasOwnProperty.call(SNAPSHOT_SQL, table) ? SNAPSHOT_SQL[table] : null;
  if (!sql) throw new AppError("BAD_SNAPSHOT_TARGET", `${table} does not carry a shipment-details snapshot`, 500);
  if (!dossierId || !id) return null;
  try {
    const projection = await forDossier(client, dossierId);
    const { rows } = await client.query(sql, [
      id,
      JSON.stringify({ ...projection, snapshot_at: new Date().toISOString() }),
    ]);
    return rows[0] || null;
  } catch (err) {
    logger.warn({ err, table, id }, "[operations] shipment-details snapshot skipped (document locked regardless)");
    return null;
  }
}

module.exports = { applyValues, partition, coerce, forDossier, formFor, summariseContainers, snapshotOnto, SNAPSHOT_SQL };
