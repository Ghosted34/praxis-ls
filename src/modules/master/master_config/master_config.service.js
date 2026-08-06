/**
 * Master-data field configuration (spec §5.2). Reads and writes
 * party_field_config; the shape/required-ness enforcement it feeds lives in
 * packages/shared (partyConfig), so the API and the form agree.
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

module.exports = { getEffective, put, enforceRequired };
