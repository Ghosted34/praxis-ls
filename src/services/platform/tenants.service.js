/**
 * Platform tenant-control service — the operations the company dashboard drives.
 * All writes land in platform.platform_audit (platform-level Watch-the-Watcher).
 * Feature changes re-project into the tenant DB feature_state.
 */
"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const m = require("./migrator");
const provisioning = require("./provisioning.service");

async function withPlatform(fn) {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    return await fn(pf);
  } finally {
    await pf.end();
  }
}

async function audit(pf, actorId, tenantId, action, entityRef, payload) {
  await pf.query(
    "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,$2,$3,$4,$5)",
    [actorId, tenantId, action, entityRef, payload || {}],
  );
}

async function tenantIdOf(pf, slug) {
  const { rows } = await pf.query(
    "SELECT tenant_id FROM platform.tenant WHERE slug=$1",
    [slug],
  );
  if (rows.length === 0) {
    const e = new Error(`tenant '${slug}' not found`);
    e.status = 404;
    throw e;
  }
  return rows[0].tenant_id;
}

function list() {
  return withPlatform(async (pf) => {
    const { rows } = await pf.query(
      "SELECT t.slug, t.display_name, t.status, t.is_live, t.sandbox_wipe_days, " +
        "p.code AS plan, td.db_name, td.capacity_tier, td.region, td.tenant_owned, " +
        "s.host AS subdomain, " +
        "(SELECT count(*) FROM platform.tenant_feature_override o WHERE o.tenant_id=t.tenant_id) AS overrides " +
        "FROM platform.tenant t " +
        "LEFT JOIN platform.plan p ON p.plan_id=t.plan_id " +
        "LEFT JOIN platform.tenant_database td ON td.tenant_id=t.tenant_id " +
        "LEFT JOIN platform.subdomain s ON s.tenant_id=t.tenant_id AND s.is_primary " +
        "ORDER BY t.created_at DESC",
    );
    return rows;
  });
}

function get(slug) {
  return withPlatform(async (pf) => {
    await tenantIdOf(pf, slug);
    const t = await pf.query(
      "SELECT t.*, p.code AS plan_code FROM platform.tenant t " +
        "LEFT JOIN platform.plan p ON p.plan_id=t.plan_id WHERE t.slug=$1",
      [slug],
    );
    const db = await pf.query(
      "SELECT td.* FROM platform.tenant_database td JOIN platform.tenant t ON t.tenant_id=td.tenant_id WHERE t.slug=$1",
      [slug],
    );
    const subs = await pf.query(
      "SELECT s.* FROM platform.subdomain s JOIN platform.tenant t ON t.tenant_id=s.tenant_id WHERE t.slug=$1",
      [slug],
    );
    return { ...t.rows[0], database: db.rows[0] || null, subdomains: subs.rows };
  });
}

function setStatus(slug, status, action, actorId) {
  return withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    const { rows } = await pf.query(
      "UPDATE platform.tenant SET status=$2 WHERE tenant_id=$1 RETURNING slug, status",
      [id, status],
    );
    await audit(pf, actorId, id, action, slug, { status });
    logger.info({ slug, status }, "tenant status changed");
    return rows[0];
  });
}

const suspend = (slug, actorId) =>
  setStatus(slug, "SUSPENDED", "tenant.suspended", actorId);
const resume = (slug, actorId) =>
  setStatus(slug, "LIVE", "tenant.resumed", actorId);

function goLive(slug, actorId) {
  return withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    const { rows } = await pf.query(
      "UPDATE platform.tenant SET is_live=true, status='LIVE' WHERE tenant_id=$1 RETURNING slug, is_live",
      [id],
    );
    await audit(pf, actorId, id, "tenant.went_live", slug, {});
    return rows[0];
  });
}

function setCapacity(slug, tier, actorId) {
  return withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    await pf.query(
      "UPDATE platform.tenant_database SET capacity_tier=$2 WHERE tenant_id=$1",
      [id, tier],
    );
    await audit(pf, actorId, id, "tenant.capacity_set", slug, { tier });
    return { slug, capacity_tier: tier };
  });
}

function setSandboxInterval(slug, days, actorId) {
  return withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    await pf.query(
      "UPDATE platform.tenant SET sandbox_wipe_days=$2 WHERE tenant_id=$1",
      [id, days],
    );
    await audit(pf, actorId, id, "tenant.sandbox_interval_set", slug, { days });
    return { slug, sandbox_wipe_days: days };
  });
}

async function setFeature(slug, featureKey, state, actorId) {
  await withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    const exists = await pf.query(
      "SELECT 1 FROM platform.feature_catalogue WHERE feature_key=$1",
      [featureKey],
    );
    if (exists.rows.length === 0) {
      const e = new Error(`unknown feature '${featureKey}'`);
      e.status = 400;
      throw e;
    }
    await pf.query(
      "INSERT INTO platform.tenant_feature_override (tenant_id, feature_key, state, changed_by) " +
        "VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, feature_key) DO UPDATE " +
        "SET state=EXCLUDED.state, changed_by=EXCLUDED.changed_by, changed_at=now()",
      [id, featureKey, state, actorId],
    );
    await audit(pf, actorId, id, "feature.toggled", `${slug}:${featureKey}`, {
      state,
    });
  });
  await provisioning.projectFeatures(slug);
  return { slug, feature_key: featureKey, state };
}

async function clearFeatureOverride(slug, featureKey, actorId) {
  await withPlatform(async (pf) => {
    const id = await tenantIdOf(pf, slug);
    await pf.query(
      "DELETE FROM platform.tenant_feature_override WHERE tenant_id=$1 AND feature_key=$2",
      [id, featureKey],
    );
    await audit(
      pf,
      actorId,
      id,
      "feature.override_cleared",
      `${slug}:${featureKey}`,
      {},
    );
  });
  await provisioning.projectFeatures(slug);
  return { slug, feature_key: featureKey };
}

function resolvedFeatures(slug) {
  return withPlatform(async (pf) => {
    await tenantIdOf(pf, slug);
    const { rows } = await pf.query(
      "SELECT fc.feature_key, fc.name, fc.module_key, " +
        "CASE WHEN ov.state IS NOT NULL THEN ov.state WHEN pf.included THEN fc.default_state ELSE 'off' END AS state, " +
        "CASE WHEN ov.state IS NOT NULL THEN 'override' WHEN pf.included THEN 'plan' ELSE 'default' END AS source " +
        "FROM platform.tenant t JOIN platform.feature_catalogue fc ON true " +
        "LEFT JOIN platform.plan_feature pf ON pf.feature_key=fc.feature_key AND pf.plan_id=t.plan_id " +
        "LEFT JOIN platform.tenant_feature_override ov ON ov.feature_key=fc.feature_key AND ov.tenant_id=t.tenant_id " +
        "WHERE t.slug=$1 ORDER BY fc.feature_key",
      [slug],
    );
    return rows;
  });
}

const listModules = () =>
  withPlatform((pf) =>
    pf
      .query("SELECT * FROM platform.module_catalogue ORDER BY sort_order")
      .then((r) => r.rows),
  );
const listFeatures = () =>
  withPlatform((pf) =>
    pf
      .query("SELECT * FROM platform.feature_catalogue ORDER BY feature_key")
      .then((r) => r.rows),
  );
const listPlans = () =>
  withPlatform((pf) =>
    pf.query("SELECT * FROM platform.plan ORDER BY code").then((r) => r.rows),
  );

module.exports = {
  list,
  get,
  suspend,
  resume,
  goLive,
  setCapacity,
  setSandboxInterval,
  setFeature,
  clearFeatureOverride,
  resolvedFeatures,
  listModules,
  listFeatures,
  listPlans,
};
