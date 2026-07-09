/**
 * Provisioning service — the reusable engine behind both the CLI scripts and the
 * company dashboard. No argv, no process.exit: callers get return values/throws.
 */
"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const m = require("./migrator");

async function migratePlatform() {
  logger.info("[praxis-db] migrating platform database...");
  await m.ensureDatabase(config.DB_NAME);
  logger.info("[praxis-db] platform database ensured");
  const cli = m.client(config.DB_NAME, { superuser: true });
  logger.info("[praxis-db] connecting to platform database...");
  await cli.connect();
  logger.info("[praxis-db] connected to platform database");
  try {
    const a = await m.applyTracked(cli, m.files.platform(), {
      scope: "platform",
    });
    logger.info("[praxis-db] platform migrations applied");
    const s = await m.applyTracked(cli, m.files.platformSeeds(), {
      scope: "platform-seed",
    });
    logger.info("[praxis-db] platform seeds applied");
    logger.info({ applied: a + s }, "platform migrated");
    return { applied: a + s };
  } finally {
    await cli.end();
  }
}

async function migrateTenantDb(dbName, opts = {}) {
  const seeds = opts.seeds !== false;
  const cli = m.client(dbName, { superuser: true });
  await cli.connect();
  try {
    await m.applyTracked(cli, m.files.tenantBootstrap(), { scope: "db" });
    let applied = 0;
    for (const schema of ["live", "sandbox"]) {
      applied += await m.applyTracked(cli, m.files.tenantSchema(), {
        searchPath: `${schema},public`,
        scope: schema,
      });
      if (seeds) {
        applied += await m.applyTracked(cli, m.files.tenantSeeds(), {
          searchPath: `${schema},public`,
          scope: `${schema}-seed`,
        });
      }
    }
    return applied;
  } finally {
    await cli.end();
  }
}

async function provisionTenant(input) {
  const slug = input.slug;
  const name = input.name;
  const plan = input.plan || "full";
  const actorId = input.actorId || null;
  if (!m.slugOk(slug)) throw new Error("invalid slug ([a-z0-9_], starts a-z)");
  if (!name) throw new Error("name is required");
  const dbName = m.tenantDbName(slug);
  const host = input.subdomain || `${slug}.${config.APP_BASE_DOMAIN}`;

  logger.info({ slug, dbName, host, plan }, "provisioning tenant");
  await m.ensureDatabase(dbName);
  await migrateTenantDb(dbName);

  const pf = m.client(config.DB_NAME, { superuser: true });
  await pf.connect();
  let tenantId;
  try {
    const planRow = await pf.query(
      "SELECT plan_id FROM platform.plan WHERE code=$1",
      [plan],
    );
    if (planRow.rows.length === 0) throw new Error(`unknown plan '${plan}'`);
    const planId = planRow.rows[0].plan_id;

    const t = await pf.query(
      "INSERT INTO platform.tenant (slug, legal_name, display_name, plan_id, status) " +
        "VALUES ($1,$2,$2,$3,'PROVISIONING') " +
        "ON CONFLICT (slug) DO UPDATE SET legal_name=EXCLUDED.legal_name, plan_id=EXCLUDED.plan_id " +
        "RETURNING tenant_id",
      [slug, name, planId],
    );
    tenantId = t.rows[0].tenant_id;

    await pf.query(
      "INSERT INTO platform.tenant_database (tenant_id, db_host, db_port, db_name, app_role, secret_ref) " +
        "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (db_host, db_port, db_name) DO NOTHING",
      [
        tenantId,
        config.TENANT_DB_HOST_DEFAULT,
        config.TENANT_DB_PORT_DEFAULT,
        dbName,
        config.TENANT_DB_APP_ROLE,
        `vault:tenant/${slug}/db-password`,
      ],
    );
    await pf.query(
      "INSERT INTO platform.subdomain (tenant_id, host, is_primary) VALUES ($1,$2,true) " +
        "ON CONFLICT (host) DO NOTHING",
      [tenantId, host],
    );
    await pf.query(
      "UPDATE platform.tenant SET status='LIVE', onboarded_at=now() WHERE tenant_id=$1",
      [tenantId],
    );
    await audit(pf, actorId, tenantId, "tenant.provisioned", slug, {
      plan,
      host,
    });
  } finally {
    await pf.end();
  }

  await projectFeatures(slug);
  logger.info({ slug }, "tenant provisioned");
  return { slug, dbName, host, tenantId };
}

async function projectFeatures(slug) {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  let features;
  try {
    const { rows } = await pf.query(
      "SELECT fc.feature_key, " +
        "CASE WHEN ov.state IS NOT NULL THEN ov.state WHEN pf.included THEN fc.default_state ELSE 'off' END AS state, " +
        "CASE WHEN ov.state IS NOT NULL THEN 'override' WHEN pf.included THEN 'plan' ELSE 'default' END AS source " +
        "FROM platform.tenant t JOIN platform.feature_catalogue fc ON true " +
        "LEFT JOIN platform.plan_feature pf ON pf.feature_key=fc.feature_key AND pf.plan_id=t.plan_id " +
        "LEFT JOIN platform.tenant_feature_override ov ON ov.feature_key=fc.feature_key AND ov.tenant_id=t.tenant_id " +
        "WHERE t.slug=$1",
      [slug],
    );
    features = rows;
  } finally {
    await pf.end();
  }
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    for (const schema of ["live", "sandbox"]) {
      for (const f of features) {
        await cli.query(
          `INSERT INTO ${schema}.feature_state (feature_key, state, source) VALUES ($1,$2,$3) ` +
            "ON CONFLICT (feature_key) DO UPDATE SET state=EXCLUDED.state, source=EXCLUDED.source, projected_at=now()",
          [f.feature_key, f.state, f.source],
        );
      }
    }
  } finally {
    await cli.end();
  }
  return { projected: features.length };
}

async function migrateTenant(slug) {
  const applied = await migrateTenantDb(m.tenantDbName(slug));
  await projectFeatures(slug);
  return { slug, applied };
}

async function migrateAllTenants() {
  const slugs = await listTenantSlugs();
  const results = [];
  for (const slug of slugs) results.push(await migrateTenant(slug));
  return results;
}

async function wipeSandbox(input) {
  const slug = input.slug;
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    await cli.query("DROP SCHEMA IF EXISTS sandbox CASCADE");
    await cli.query("CREATE SCHEMA sandbox");
    await cli.query(
      "DELETE FROM public.schema_migration WHERE scope IN ('sandbox','sandbox-seed')",
    );
    await m.applyTracked(cli, m.files.tenantSchema(), {
      searchPath: "sandbox,public",
      scope: "sandbox",
    });
    await m.applyTracked(cli, m.files.tenantSeeds(), {
      searchPath: "sandbox,public",
      scope: "sandbox-seed",
    });
  } finally {
    await cli.end();
  }
  await projectFeatures(slug);
  return { slug };
}

async function listTenantSlugs() {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const { rows } = await pf.query(
      "SELECT slug FROM platform.tenant WHERE status IN ('LIVE','PROVISIONING') ORDER BY slug",
    );
    return rows.map((r) => r.slug);
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

module.exports = {
  migratePlatform,
  provisionTenant,
  migrateTenant,
  migrateAllTenants,
  wipeSandbox,
  projectFeatures,
  listTenantSlugs,
};
