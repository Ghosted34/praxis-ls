/**
 * Plan administration (platform.plan + platform.plan_feature). Create/edit/
 * delete plans and edit each plan's included-feature set. Editing a plan's
 * features (or reassigning tenants during delete) RE-PROJECTS every affected
 * tenant's feature_state so the change reaches the tenant apps — same mechanism
 * as a per-tenant feature override.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const platformDb = require("./db");
const provisioning = require("./provisioning.service");

async function audit(actorId, action, entityRef, payload) {
  await platformDb.query(
    "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,NULL,$2,$3,$4)",
    [actorId || null, action, entityRef, payload || {}],
  );
}

/** Re-project feature_state for every tenant currently on `planId`. */
async function reprojectPlanTenants(planId) {
  const { rows } = await platformDb.query(
    "SELECT slug FROM platform.tenant WHERE plan_id = $1",
    [planId],
  );
  for (const r of rows) {
    await provisioning.projectFeatures(r.slug);
  }
  return rows.length;
}

function list() {
  return platformDb
    .query(
      `SELECT p.*,
         (SELECT count(*)::int FROM platform.tenant t WHERE t.plan_id = p.plan_id) AS tenant_count,
         (SELECT count(*)::int FROM platform.plan_feature pf WHERE pf.plan_id = p.plan_id AND pf.included) AS included_features
       FROM platform.plan p ORDER BY p.code`,
    )
    .then((r) => r.rows);
}

async function planIdOf(code) {
  const { rows } = await platformDb.query("SELECT plan_id FROM platform.plan WHERE plan_id = $1 OR code = $1", [code]);
  if (!rows[0]) throw new AppError("NOT_FOUND", `plan '${code}' not found`, 404);
  return rows[0].plan_id;
}

async function create({ code, name, priceSetupXaf, priceYearlyXaf }, actorId) {
  const c = String(code || "").trim().toLowerCase();
  if (!c || !name) throw new AppError("BAD_INPUT", "code and name are required", 422);
  try {
    const { rows } = await platformDb.query(
      `INSERT INTO platform.plan (code, name, price_setup_xaf, price_yearly_xaf)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [c, name, priceSetupXaf || 0, priceYearlyXaf || 0],
    );
    await audit(actorId, "plan.created", c, { name });
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new AppError("CODE_TAKEN", "A plan with that code already exists", 409);
    throw e;
  }
}

async function update(planId, { name, priceSetupXaf, priceYearlyXaf }, actorId) {
  const id = await planIdOf(planId);
  const sets = [];
  const params = [];
  const add = (frag, val) => { params.push(val); sets.push(`${frag} $${params.length}`); };
  if (name !== undefined) add("name =", name);
  if (priceSetupXaf !== undefined) add("price_setup_xaf =", priceSetupXaf);
  if (priceYearlyXaf !== undefined) add("price_yearly_xaf =", priceYearlyXaf);
  if (sets.length === 0) {
    const { rows } = await platformDb.query("SELECT * FROM platform.plan WHERE plan_id = $1", [id]);
    return rows[0];
  }
  params.push(id);
  const { rows } = await platformDb.query(
    `UPDATE platform.plan SET ${sets.join(", ")} WHERE plan_id = $${params.length} RETURNING *`,
    params,
  );
  await audit(actorId, "plan.updated", rows[0].code, { name, priceSetupXaf, priceYearlyXaf });
  return rows[0];
}

/** Feature catalogue with this plan's inclusion flag (for the plan editor). */
async function features(planId) {
  const id = await planIdOf(planId);
  const { rows } = await platformDb.query(
    `SELECT fc.feature_key, fc.name, fc.module_key,
            COALESCE(pf.included, false) AS included
       FROM platform.feature_catalogue fc
       LEFT JOIN platform.plan_feature pf ON pf.feature_key = fc.feature_key AND pf.plan_id = $1
      ORDER BY fc.feature_key`,
    [id],
  );
  return rows;
}

/** Replace the plan's included-feature set, then re-project affected tenants. */
async function setFeatures(planId, featureList, actorId) {
  const id = await planIdOf(planId);
  if (!Array.isArray(featureList)) throw new AppError("BAD_INPUT", "features must be an array", 422);
  for (const f of featureList) {
    await platformDb.query(
      `INSERT INTO platform.plan_feature (plan_id, feature_key, included)
       VALUES ($1,$2,$3)
       ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included`,
      [id, f.feature_key, f.included !== false],
    );
  }
  const reprojected = await reprojectPlanTenants(id);
  await audit(actorId, "plan.features_updated", String(planId), { count: featureList.length, reprojected });
  return { plan_id: id, updated: featureList.length, reprojected };
}

/**
 * Delete a plan, moving any tenants on it to `replacementCode` first (then
 * re-projecting them). Refuses if the plan is in use and no valid, different
 * replacement is given.
 */
async function remove(planId, replacementCode, actorId) {
  const id = await planIdOf(planId);
  const { rows: inUse } = await platformDb.query("SELECT count(*)::int AS n FROM platform.tenant WHERE plan_id = $1", [id]);
  let moved = 0;
  if (inUse[0].n > 0) {
    if (!replacementCode) throw new AppError("PLAN_IN_USE", "Plan has tenants; provide a replacement plan to reassign them", 409);
    const repl = await planIdOf(replacementCode);
    if (String(repl) === String(id)) throw new AppError("BAD_REPLACEMENT", "Replacement plan must differ from the one being deleted", 422);
    const { rows: movedRows } = await platformDb.query(
      "UPDATE platform.tenant SET plan_id = $2 WHERE plan_id = $1 RETURNING slug",
      [id, repl],
    );
    moved = movedRows.length;
    for (const r of movedRows) {
      await provisioning.projectFeatures(r.slug);
    }
  }
  // plan_feature rows cascade on plan delete (FK ON DELETE CASCADE).
  await platformDb.query("DELETE FROM platform.plan WHERE plan_id = $1", [id]);
  await audit(actorId, "plan.deleted", String(planId), { moved, replacement: replacementCode || null });
  return { plan_id: id, deleted: true, reassigned: moved };
}

module.exports = { list, create, update, features, setFeatures, remove };
