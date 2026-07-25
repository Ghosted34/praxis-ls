/**
 * Provisioning service — the reusable engine behind both the CLI scripts and the
 * company dashboard. No argv, no process.exit: callers get return values/throws.
 */
"use strict";

const argon2 = require("argon2");
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
  await seedDisplayName(slug, name);
  logger.info({ slug }, "tenant provisioned");
  return { slug, dbName, host, tenantId };
}

/**
 * Seed the tenant-facing brand name (setting appearance.display_name, both
 * schemas) from the provisioning display name, so a fresh tenant opens with a
 * sensible name on the app header / login / browser tab instead of the generic
 * fallback. ON CONFLICT DO NOTHING — the tenant's own Appearance edit always
 * wins and re-provisioning never clobbers it.
 */
async function seedDisplayName(slug, name) {
  if (!name) return;
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    for (const schema of ["live", "sandbox"]) {
      await cli.query(
        `INSERT INTO ${schema}.setting (section, key, value)
         VALUES ('appearance', 'display_name', to_jsonb($1::text))
         ON CONFLICT (section, key) DO NOTHING`,
        [name],
      );
    }
  } finally {
    await cli.end();
  }
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

/**
 * Bootstrap a tenant's first admin from the platform console (same effect as
 * scripts/tenant/create-admin.js). A freshly provisioned tenant has no app_user
 * rows, so nobody can log in; this creates one in the tenant's LIVE schema with
 * an Argon2id password and assigns a role (default CEO, which bypasses RBAC so
 * the first user can then grant scoped access to everyone else). Idempotent on
 * email (re-runs reset the password + reactivate).
 */
async function createAdmin(input) {
  const slug = input.slug;
  const email = String(input.email || "").trim().toLowerCase();
  const password = input.password;
  const name = input.name || email;
  const role = input.role || "CEO";
  if (!slug) throw new Error("slug is required");
  if (!email || !password) {
    const e = new Error("email and password are required");
    e.status = 400;
    throw e;
  }

  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  let userId;
  try {
    await cli.query("SET search_path = live, public");
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows: userRows } = await cli.query(
      `INSERT INTO app_user (email, full_name, password_hash, status)
       VALUES ($1,$2,$3,'ACTIVE')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
       RETURNING user_id`,
      [email, name, hash],
    );
    userId = userRows[0].user_id;
    const { rows: roleRows } = await cli.query(
      "SELECT role_id FROM role WHERE code = $1",
      [role],
    );
    if (roleRows.length === 0) {
      const e = new Error(`role '${role}' is not seeded in this tenant`);
      e.status = 400;
      throw e;
    }
    await cli.query(
      "INSERT INTO user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [userId, roleRows[0].role_id],
    );
  } finally {
    await cli.end();
  }

  // Audit the bootstrap into the platform trail (Watch-the-Watcher).
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const t = await pf.query(
      "SELECT tenant_id FROM platform.tenant WHERE slug = $1",
      [slug],
    );
    if (t.rows[0]) {
      await audit(pf, input.actorId || null, t.rows[0].tenant_id, "tenant.admin_created", slug, {
        email,
        role,
      });
    }
  } finally {
    await pf.end();
  }

  logger.info({ slug, email, role }, "tenant admin created");
  return { slug, email, role, user_id: userId };
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
  createAdmin,
  listTenantSlugs,
};
