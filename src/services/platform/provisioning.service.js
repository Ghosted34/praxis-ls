/**
 * Provisioning service — the reusable engine behind both the CLI scripts and the
 * company dashboard. No argv, no process.exit: callers get return values/throws.
 */
"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const m = require("./migrator");
const { mirrorUsersIntoSandbox } = require("../../shared/db/sandbox-user-mirror");
const passwordPolicy = require("../../shared/security/password-policy");
const dbCredentials = require("../tenant/db-credential.service");

/** The cluster-wide Postgres role name for a tenant. Roles are not per-database. */
const tenantRoleName = (slug) => `praxis_${slug}`;

/**
 * WS-S2 — give this tenant its own Postgres role and password.
 *
 * Creates (or rotates) a least-privilege role scoped to exactly one tenant
 * database, stores the password in the platform vault, and returns the role name
 * so the caller can record it on `platform.tenant_database.app_role`.
 *
 * THE PART THAT ACTUALLY CREATES ISOLATION is the `REVOKE CONNECT ... FROM
 * PUBLIC`. Postgres grants CONNECT on every database to PUBLIC by default, so
 * creating one role per tenant achieves nothing on its own — every tenant role
 * could still open every tenant database. Revoking PUBLIC and granting CONNECT
 * back to only this tenant's role (plus the superuser, which bypasses grants) is
 * what makes the negative test pass.
 *
 * Idempotent: safe to re-run, which is what makes it usable both at provision
 * time and as the backfill/rotation path for existing tenants.
 */
async function ensureTenantRole(slug, dbName, opts = {}) {
  const rotate = opts.rotate === true;
  const role = tenantRoleName(slug);

  // Existing tenants already have a credential; provisioning must not silently
  // rotate one out from under a running pool unless explicitly asked.
  if (!rotate && (await dbCredentials.hasOwnCredential(slug))) {
    logger.info({ slug, role }, "tenant DB role already provisioned — leaving credential in place");
    return { role, rotated: false };
  }

  // URL-safe, no quoting hazards in a DDL string literal.
  const password = crypto.randomBytes(24).toString("base64url");

  const cli = m.client(dbName, { superuser: true });
  await cli.connect();
  try {
    // CREATE ROLE is cluster-wide; running it from the tenant DB is fine.
    const { rows } = await cli.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
    if (rows.length === 0) {
      await cli.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      logger.info({ slug, role }, "created tenant DB role");
    } else {
      await cli.query(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}'`);
      logger.info({ slug, role }, "rotated tenant DB role password");
    }

    // Close the default-open door, then let exactly this role back in.
    await cli.query(`REVOKE CONNECT ON DATABASE "${dbName}" FROM PUBLIC`);
    await cli.query(`GRANT CONNECT ON DATABASE "${dbName}" TO "${role}"`);

    // The API's working set: both schemas, existing objects and future ones.
    // Default privileges are attributed to the role that CREATES the object —
    // migrations run as the superuser, so they must be declared FOR that role.
    const superuser = config.TENANT_DB_SUPERUSER;
    for (const schema of ["live", "sandbox", "public"]) {
      await cli.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
      await cli.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
      );
      await cli.query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`,
      );
      await cli.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${superuser}" IN SCHEMA "${schema}" ` +
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
      );
      await cli.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE "${superuser}" IN SCHEMA "${schema}" ` +
          `GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
      );
    }

    // Vault write LAST: a stored credential must never describe a role that
    // does not exist or cannot connect. If anything above threw, nothing was
    // stored and the tenant keeps using the shared credential.
    await dbCredentials.putCredential(slug, password, opts.actorId || null);

    // AND the registry must be told which role that password belongs to.
    //
    // Missing this is not a cosmetic gap, it is a tenant outage. The pool takes
    // its USERNAME from `tenant_database.app_role` and its PASSWORD from the
    // vault. Store one without the other and the pool authenticates as the old
    // deploy-wide role using the new role's password — "password authentication
    // failed", every request, immediately. A backfill that only did half of
    // this would break each tenant as it "secured" it.
    //
    // Affects 0 rows during initial provisioning, because provisionTenant()
    // calls this BEFORE inserting the tenant_database row and passes the
    // returned role name into that insert. It is the backfill/rotation path
    // this exists for.
    // `cli` is connected to the TENANT database; this write is on the PLATFORM
    // one, so it needs its own connection.
    const pf = m.client(config.DB_NAME, { superuser: true });
    await pf.connect();
    let upd;
    try {
      upd = await pf.query(
        `UPDATE platform.tenant_database td
            SET app_role = $2
           FROM platform.tenant t
          WHERE t.tenant_id = td.tenant_id AND t.slug = $1::text`,
        [slug, role],
      );
    } finally {
      await pf.end();
    }
    if (upd.rowCount > 0) {
      logger.info({ slug, role }, "tenant_database.app_role repointed at the new role");
    }

    return { role, rotated: true };
  } finally {
    await cli.end();
  }
}

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

  // WS-S2: give this tenant its own DB role + password before the platform row
  // is written, so `app_role` records the role that actually exists. Outside the
  // transaction below for the same reason CREATE DATABASE is — role DDL and the
  // vault write are not rollback-able by a transaction on another connection.
  // A failure here is non-fatal: the tenant provisions and falls back to the
  // shared credential, and `ensureTenantRole` is idempotent so a re-run fixes it.
  let appRole = config.TENANT_DB_APP_ROLE;
  try {
    const provisioned = await ensureTenantRole(slug, dbName, { actorId });
    appRole = provisioned.role;
  } catch (err) {
    logger.error(
      { err, slug, dbName },
      "tenant DB role provisioning failed — tenant will use the shared credential until reprovisioned",
    );
  }

  const pf = m.client(config.DB_NAME, { superuser: true });
  await pf.connect();
  let tenantId;
  try {
    // DATA 5.6. These five platform writes — tenant upsert, tenant_database,
    // subdomain, status='LIVE', audit — used to run on a bare client with no
    // BEGIN, so each autocommitted independently. A failure part-way left a
    // tenant registered with no database row or no subdomain, or stuck in
    // PROVISIONING with its schema fully built and nothing pointing at it.
    // Every one of those states needs a human to diagnose and unpick, because
    // the tenant looks half-real from every angle.
    //
    // One transaction makes the platform's view of a tenant all-or-nothing.
    // The DATABASE ITSELF is deliberately outside it: `ensureDatabase` and the
    // schema migration above are CREATE DATABASE and DDL, which cannot be
    // rolled back by a transaction on a different connection. That asymmetry
    // is the right way round — an orphaned database with no platform row is
    // inert and re-provisioning is idempotent (`ON CONFLICT (slug) DO UPDATE`),
    // whereas a platform row pointing at a database that does not exist routes
    // live traffic into a 500.
    await pf.query("BEGIN");

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
        "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (db_host, db_port, db_name) " +
        // WS-S2: a reprovision that (re)created the role must update app_role,
        // or the registry keeps connecting as the old deploy-wide role.
        "DO UPDATE SET app_role = EXCLUDED.app_role, secret_ref = EXCLUDED.secret_ref",
      [
        tenantId,
        config.TENANT_DB_HOST_DEFAULT,
        config.TENANT_DB_PORT_DEFAULT,
        dbName,
        appRole,
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
    await pf.query("COMMIT");
  } catch (err) {
    // A failed ROLLBACK must never mask the error that caused it — same rule
    // as shared/db/tx.js.
    try {
      await pf.query("ROLLBACK");
    } catch {
      /* connection already gone; the original error is the useful one */
    }
    throw err;
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
      { slug, err },
      "sandbox user mirror failed — TEST-mode writes may fail for unmirrored users; run scripts/tenant/mirror-users.js",
    );
  } finally {
    await cli.end();
  }
}

/**
 * Migrate every tenant, and END IN A KNOWN STATE whatever happens.
 *
 * DATA 3.2 (High) and TEST-D3 (High). This used to be a bare
 * `for … results.push(await migrateTenant(slug))` with no try/catch, so the
 * first tenant to throw aborted the loop. The fleet was then split at an
 * arbitrary point: tenants before the failure upgraded, tenants after it
 * untouched, and NOTHING RECORDED WHERE THE LINE FELL. `scripts/deploy.sh`
 * runs this on every deploy, so the split happened during a deploy, while the
 * new image — which expects the new schema — was rolling out to all of them.
 *
 * A tenant left behind does not fail loudly. It fails the next time a query
 * touches a column that migration was going to add, as a 42703 from deep inside
 * a feature, on one tenant, hours later.
 *
 * CONTINUE RATHER THAN STOP, deliberately. If the cause is tenant-specific data
 * then stopping punishes every tenant after it in the list for one tenant's
 * problem. If the cause is systematic then continuing costs a few more seconds
 * and produces the far more useful message "all 12 failed" instead of "the
 * first one failed". Either way the outcome is enumerated per tenant, which is
 * the part that was missing: the caller can see exactly which databases are on
 * which side of the line.
 *
 * Throws AFTER the sweep if anything failed, so a deploy still goes red — the
 * change is that it goes red having done as much as it safely could and having
 * said precisely what it did.
 */
async function migrateAllTenants() {
  const slugs = await listTenantSlugs();
  const results = [];
  const failures = [];

  for (const slug of slugs) {
    try {
       
      results.push(await migrateTenant(slug));
    } catch (err) {
      logger.error({ err, slug }, "tenant migration failed — continuing with the rest of the fleet");
      results.push({ slug, applied: null, error: err.message });
      failures.push({ slug, error: err.message });
    }
  }

  if (failures.length) {
    const err = new Error(
      `${failures.length} of ${slugs.length} tenant(s) failed to migrate: ` +
        `${failures.map((f) => `${f.slug} (${f.error})`).join("; ")}. ` +
        "The rest of the fleet was migrated. Run scripts/db/fleet-status.js to see who is on what.",
    );
    err.code = "FLEET_MIGRATION_PARTIAL";
    err.results = results;
    throw err;
  }
  return results;
}

/**
 * What schema version is each tenant actually on?
 *
 * DATA 3.2's other half. Even with containment, a mixed fleet is only
 * manageable if it is visible, and there was no way to ask. Reads each tenant's
 * own `public.schema_migration` ledger — the same table the migrator writes —
 * so this reports what was APPLIED, not what someone believes was applied.
 *
 * Best-effort per tenant: an unreachable database is reported as such rather
 * than failing the whole report, because "which tenants can I not even reach"
 * is exactly what you want to know during an incident.
 */
async function fleetSchemaStatus() {
  const slugs = await listTenantSlugs();
  const expected = m.files.tenantSchema().length;
  const out = [];

  for (const slug of slugs) {
    const cli = m.client(m.tenantDbName(slug), { superuser: true });
    try {
       
      await cli.connect();
       
      const { rows } = await cli.query(
        `SELECT scope, COUNT(*)::int AS applied, MAX(filename) AS latest, MAX(applied_at) AS last_applied_at
           FROM public.schema_migration GROUP BY scope ORDER BY scope`,
      );
      const live = rows.find((r) => r.scope === "live") || { applied: 0, latest: null };
      out.push({
        slug,
        applied: live.applied,
        expected,
        latest: live.latest,
        last_applied_at: live.last_applied_at || null,
        behind: expected - live.applied,
        scopes: rows,
      });
    } catch (err) {
      out.push({ slug, error: err.message });
    } finally {
       
      await cli.end().catch(() => {});
    }
  }

  const behind = out.filter((t) => t.behind > 0);
  const unreachable = out.filter((t) => t.error);
  return {
    expected,
    tenants: out,
    // `drifted` is the single fact a deploy or a health probe wants.
    drifted: behind.length > 0 || unreachable.length > 0,
    behind: behind.map((t) => t.slug),
    unreachable: unreachable.map((t) => t.slug),
  };
}

/**
 * Rebuild a tenant's sandbox schema from scratch.
 *
 * DATA 5.6. This used to run DROP SCHEMA → CREATE SCHEMA → ledger DELETE →
 * re-apply on a bare client with no transaction. The window between the DROP
 * and a successful rebuild is the dangerous part: a crash, a dropped
 * connection or a failing migration file left the tenant with NO SANDBOX
 * SCHEMA AT ALL and a ledger that still claimed the sandbox scopes were
 * applied. TEST mode then failed for every user of that tenant, and the next
 * migrate pass would not rebuild it because the ledger said there was nothing
 * to do.
 *
 * Postgres CAN roll back DDL — `DROP SCHEMA` and `CREATE SCHEMA` are
 * transactional here, unlike `CREATE DATABASE` in provisionTenant — so the
 * whole rebuild genuinely is all-or-nothing. On failure the tenant keeps the
 * sandbox it had.
 *
 * The cost is that the schema is locked for the duration of the rebuild rather
 * than being briefly absent. That is the correct trade: a sandbox that is
 * unavailable for thirty seconds is an inconvenience, and a sandbox that has
 * silently ceased to exist is an incident.
 */
async function wipeSandbox(input) {
  const slug = input.slug;
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    await cli.query("BEGIN");
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
    await cli.query("COMMIT");
  } catch (err) {
    try {
      await cli.query("ROLLBACK");
    } catch {
      /* connection already gone; the original error is the useful one */
    }
    logger.error(
      { slug, err },
      "sandbox wipe failed and was rolled back — the tenant keeps its previous sandbox",
    );
    throw err;
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
    // SEC H6. This creates the TENANT ADMINISTRATOR, who typically receives the
    // CEO role — the account that bypasses every permission check in the
    // product. It was protected by zod's min(8) and nothing else.
    await passwordPolicy.assertStrongPassword(password, { email });
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
  ensureTenantRole,
  tenantRoleName,
  migrateTenant,
  migrateAllTenants,
  fleetSchemaStatus,
  wipeSandbox,
  projectFeatures,
  enforceDependencies,
  toDepsArray,
  createAdmin,
  listTenantSlugs,
};
