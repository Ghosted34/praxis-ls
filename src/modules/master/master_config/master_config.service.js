/**
 * Master-data field configuration (spec §5.2, 14030). Reads and writes
 * party_field_config; the shape/required-ness enforcement it feeds lives in
 * packages/shared (partyConfig), so the API and the form agree.
 *
 * TWO POLICIES, DELIBERATELY SEPARATE:
 *   is_required             → enforced when the record is CREATED
 *                             (`enforceRequired`).
 *   required_for_activation → enforced when the party is ACTIVATED
 *                             (`missingActivationFields`, read by the
 *                             verification gate and the compliance engine).
 * They are different questions — "what do we want on file" versus "what must be
 * there before this counterparty can trade" — and conflating them is what put a
 * Bank RIB on every fresh client's activation checklist.
 */
"use strict";
const repo = require("./master_config.repo");
const { partyConfig } = require("@praxis/shared");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

function normApplies(a) {
  const v = String(a || "").toUpperCase();
  if (v !== "CLIENT" && v !== "SUPPLIER") throw new AppError("BAD_APPLIES_TO", "appliesTo must be CLIENT or SUPPLIER", 422);
  return v;
}

/** The effective config for one side — stored rows, or seeded defaults. */
async function getEffective(client, appliesTo) {
  const a = normApplies(appliesTo);
  const rows = await repo.loadConfig(client, a);
  return { applies_to: a, groups: partyConfig.GROUP_ORDER, fields: partyConfig.effectiveConfig(a, rows) };
}

/** Replace/patch the tenant's config for one side (Admin/Manager; audited). */
async function put(client, { appliesTo, fields, actor = {} }) {
  const a = normApplies(appliesTo);
  if (!Array.isArray(fields)) throw new AppError("VALIDATION_ERROR", "fields must be an array", 422);
  await client.query("BEGIN");
  try {
    for (const f of fields) {
      if (!f || !f.field_key) throw new AppError("VALIDATION_ERROR", "each field needs a field_key", 422);
      await repo.upsert(client, a, f);
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "master_config.updated",
      moduleKey: a === "SUPPLIER" ? "MOD-04" : "MOD-03",
      entityRef: `master_config:${a}`,
      after: { count: fields.length },
    });
    await client.query("COMMIT");
    return getEffective(client, a);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

/**
 * The child table a STRUCTURAL field key resolves against for a stored party,
 * or null for a scalar column on the master row.
 *
 * `partyConfig.resolveValue` maps `bank_accounts` / `contacts.billing` /
 * `registrations` / … to the nested collection a CREATE payload carries. A
 * stored party has those as rows in a child table, not as columns, so the
 * activation check has to look there or it would demand a bank account from a
 * party that has three.
 */
const structuralTable = (key, kind) => {
  if (key === "bank_accounts") return { table: `${kind}_bank_account`, fk: `${kind}_id` };
  if (key === "documents") return { table: `${kind}_document`, fk: `${kind}_id` };
  if (key === "beneficial_owners") return { table: `${kind}_beneficial_owner`, fk: `${kind}_id` };
  if (key.startsWith("contacts")) return { table: `${kind}_contact`, fk: `${kind}_id` };
  if (key.startsWith("addresses")) return { table: `${kind}_address`, fk: `${kind}_id` };
  if (key === "registrations") return { table: "party_registration", fk: `${kind}_id` };
  return null;
};

/**
 * The ACTIVATION requirements a stored party does not yet meet (14030): the
 * tenant's `required_for_activation` fields whose value is blank, as
 * `{ field_key, label }`.
 *
 * `enforceRequired` runs when a record is CREATED; this is the other half of
 * the same policy — what must be on file before the party may be ACTIVATED —
 * and it is consulted in one place (the verification gate) and rendered on the
 * 360 checklist through the compliance engine, so the two cannot disagree.
 *
 * Only the keys a tenant actually gates on are resolved, so the common case
 * (no activation fields) costs one config read and no child queries at all.
 */
async function missingActivationFields(client, { appliesTo, kind, party = {} }) {
  const a = normApplies(appliesTo);
  const rows = await repo.loadConfig(client, a);
  const config = partyConfig.effectiveConfig(a, rows).filter((r) => r.required_for_activation === true);
  if (config.length === 0) return [];

  const data = { ...party };
  for (const key of new Set(config.map((c) => c.field_key))) {
    const spec = structuralTable(key, kind === "supplier" ? "supplier" : "client");
    if (!spec) continue;
    const partyId = kind === "supplier" ? party.supplier_id : party.client_id;
    if (!partyId) continue;
    const { rows: [{ n }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM ${spec.table} WHERE ${spec.fk} = $1`,
      [partyId],
    );
    // The check only asks "is this collection empty"; a one-element stand-in
    // answers that without dragging the rows through the process.
    data[key] = n > 0 ? [n] : [];
  }

  const chk = partyConfig.checkActivationRequired(data, config);
  const byKey = new Map(config.map((c) => [c.field_key, c]));
  return chk.missing.map((key) => ({
    field_key: key,
    label: byKey.get(key)?.label_override || key,
  }));
}

/**
 * Enforce tenant required-ness on top of the static schema. Called by the
 * client/supplier create services with the parsed payload; throws 422 naming the
 * fields the tenant policy requires that the payload left blank.
 */
async function enforceRequired(client, appliesTo, data) {
  const a = normApplies(appliesTo);
  const rows = await repo.loadConfig(client, a);
  const chk = partyConfig.checkRequired(data || {}, partyConfig.effectiveConfig(a, rows));
  if (!chk.ok) {
    throw new AppError(
      "REQUIRED_FIELDS_MISSING",
      `Missing required field(s): ${chk.missing.join(", ")}`,
      422,
      chk.missing.reduce((acc, k) => ({ ...acc, [k]: ["required by tenant policy"] }), {}),
    );
  }
}

module.exports = { getEffective, put, enforceRequired, missingActivationFields };
