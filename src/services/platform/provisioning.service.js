/**
 * Provisioning service — the reusable engine behind both the CLI scripts and the
 * company dashboard. No argv, no process.exit: callers get return values/throws.
 */
"use strict";

const argon2 = require("argon2");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const m = require("./migrator");
const { mirrorUsersIntoSandbox } = require("../../shared/db/sandbox-user-mirror");

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

/**
 * Enforce `feature_catalogue.depends_on` at projection time: a feature may be
 * 'on' only if every feature it depends on is itself 'on'. depends_on has lived
 * in the platform catalogue since 0020 but the projection never honoured it, so a
 * child could be entitled with its parent off — the exact shape of the session-10
 * "19 modules were dark" bug, one layer up (e.g. ai.assistant.backend depends_on
 * {ai.assistant}).
 *
 * Applied to a fixpoint so a broken dependency cascades through a chain (A→B→C:
 * if C is off, B is forced off, which then forces A off). A dependency that isn't
 * in the catalogue at all counts as unmet — an unknown key can't be satisfied, so
 * the safe resolution is off. Mutates + returns `features` in place; the resolved
 * `source` is preserved (the tenant `feature_state.source` CHECK only allows
 * plan|override|default) while `state` becomes 'off'.
 */
/**
 * Normalise a feature's `depends_on` to a string[] of feature keys.
 *
 * `depends_on` is a `citext[]`. citext is an extension type with no array parser
 * registered in node-postgres, so the driver returns the raw Postgres array
 * literal as a STRING ("{}", "{ai.assistant}", "{a,b}") rather than a JS array —
 * iterating that string character-by-character (what a naive `for..of` does) once
 * turned EVERY feature off, including no-dependency ones, because "{" is not a
 * key. The query now casts to text[] (which the driver DOES parse), and this
 * parser is the belt-and-braces fallback so the function is correct whether it is
 * handed an array or a literal string.
 */
function toDepsArray(v) {
  if (Array.isArray(v)) return v.map((s) => String(s));
  if (typeof v === "string") {
    const inner = v.replace(/^\{/, "").replace(/\}$/, "").trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((s) => s.replace(/^"(.*)"$/, "$1").trim())
      .filter(Boolean);
  }
  return [];
}

function enforceDependencies(features) {
  const byKey = new Map(features.map((f) => [String(f.feature_key), f]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of features) {
      if (f.state !== "on") continue;
      const deps = toDepsArray(f.depends_on);
      for (const dep of deps) {
        const parent = byKey.get(String(dep));
        if (!parent || parent.state !== "on") {
          f.state = "off";
          changed = true;
          break;
        }
      }
    }
  }
  return features;
}

async function projectFeatures(slug) {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  let features;
  try {
    const { rows } = await pf.query(
      // depends_on::text[] — the column is citext[], which node-postgres returns
      // as a RAW STRING (no parser for the extension type). Casting to text[] makes
      // the driver hand back a real JS array; enforceDependencies also self-defends
      // via toDepsArray in case a caller passes the unparsed form.
      "SELECT fc.feature_key, fc.depends_on::text[] AS depends_on, " +
        "CASE WHEN ov.state IS NOT NULL THEN ov.state WHEN pf.included THEN fc.default_state ELSE 'off' END AS state, " +
        "CASE WHEN ov.state IS NOT NULL THEN 'override' WHEN pf.included THEN 'plan' ELSE 'default' END AS source " +
        "FROM platform.tenant t JOIN platform.feature_catalogue fc ON true " +
        "LEFT JOIN platform.plan_feature pf ON pf.feature_key=fc.feature_key AND pf.plan_id=t.plan_id " +
        "LEFT JOIN platform.tenant_feature_override ov ON ov.feature_key=fc.feature_key AND ov.tenant_id=t.tenant_id " +
        "WHERE t.slug=$1",
      [slug],
    );
    const wantedOn = new Set(rows.filter((f) => f.state === "on").map((f) => f.feature_key));
    features = enforceDependencies(rows);
    // An unexplained "off" is one an operator will try to toggle, fail to change,
    // and report as a bug. `source` can't carry the reason (the tenant
    // feature_state.source CHECK allows only plan|override|default), so it goes
    // to the log instead.
    const blocked = features.filter((f) => f.state !== "on" && wantedOn.has(f.feature_key));
    if (blocked.length) {
      logger.warn(
        { slug, blocked: blocked.map((f) => `${f.feature_key}<-${toDepsArray(f.depends_on).join(",")}`) },
        "[features] forced off because a dependency is off",
      );
    }
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
  await mirrorUsersOnMigrate(slug);
  return { slug, applied };
}

/**
 * Self-heal `sandbox.app_user` on every tenant migration pass.
 *
 * `scripts/deploy.sh` runs the migrate service (platform + all tenants) on every
 * deploy, which makes this the one place guaranteed to touch every tenant on every
 * environment — so drift can never silently accumulate the way it did before
 * 2026-08-02 (a wipe-time-only mirror left every user created afterwards missing,
 * and their first TEST-mode write failed with 23503). The mirror is idempotent and
 * inserts nothing on a healthy tenant, so the cost is one INSERT…SELECT per deploy.
 *
 * Best-effort by design: a deploy must not fail over sandbox convenience data. A
 * failure is logged at error level and `scripts/tenant/mirror-users.js` re-runs it
 * on demand.
 */
async function mirrorUsersOnMigrate(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    const { mirrored } = await mirrorUsersIntoSandbox(cli);
    if (mirrored) logger.info({ slug, mirrored }, "mirrored users into sandbox");
  } catch (err) {
    logger.error(
      { slug, err: err.message },
      "sandbox user mirror failed — TEST-mode writes may fail for unmirrored users; run scripts/tenant/mirror-users.js",
    );
  } finally {
    await cli.end();
  }
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
    // Repopulate sandbox.app_user — the rebuilt schema has no users, and 60+
    // tenant columns are `REFERENCES app_user(user_id)`. See
    // shared/db/sandbox-user-mirror.js for the full why.
    await mirrorUsersIntoSandbox(cli);
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
    // Mirror the new admin into sandbox. THIS is the moment that closes the
    // fresh-tenant hole: provisioning cannot mirror (it runs before any user
    // exists), so without this the tenant's very first TEST-mode write fails its
    // actor FK with 23503. Same reason the app_user service mirrors on create.
    await mirrorUsersIntoSandbox(cli, { userId });
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
  enforceDependencies,
  toDepsArray,
  createAdmin,
  listTenantSlugs,
};
