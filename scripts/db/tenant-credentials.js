#!/usr/bin/env node
/**
 * WS-S2 — per-tenant database credentials: status, backfill, rotate, verify.
 *
 * Tenants are physically separate databases, but every pool authenticated with
 * the same shared `DB_PASSWORD`, so one leaked app password reached every tenant
 * DB. This script is the operational half of the fix: it gives each tenant its
 * own least-privilege Postgres role, and — the part that matters — PROVES the
 * credential does not open anyone else's database.
 *
 *   node scripts/db/tenant-credentials.js --status
 *   node scripts/db/tenant-credentials.js --backfill              # all tenants missing one
 *   node scripts/db/tenant-credentials.js --backfill --slug=acme  # just one
 *   node scripts/db/tenant-credentials.js --rotate --slug=acme    # new password, live
 *   node scripts/db/tenant-credentials.js --verify                # the negative test
 *
 * `--verify` is the objective test WS-S2 closes on: for each tenant it opens a
 * connection with that tenant's credential to its OWN database (must succeed)
 * and to every OTHER tenant database (must all fail). Exit 1 on any breach, so
 * this can run as a CI or deploy gate.
 *
 * Backfill is safe to run against a live deployment: resolution falls back to
 * the shared credential, so a tenant is only ever moved forward, one at a time,
 * and an already-provisioned tenant is skipped unless `--rotate` is given.
 */
"use strict";

const { Client } = require("pg");
const { config } = require("../../src/config/env");
const registry = require("../../src/services/tenant/registry.service");
const dbCredentials = require("../../src/services/tenant/db-credential.service");
const {
  ensureTenantRole,
  tenantRoleName,
} = require("../../src/services/platform/provisioning.service");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};

const SLUG = val("slug");
const JSON_OUT = has("--json");

/** Try to connect as `role` to `dbName`. Returns { ok, error }. Never throws. */
async function tryConnect(role, password, dbName) {
  const cli = new Client({
    host: config.TENANT_DB_HOST_DEFAULT,
    port: config.TENANT_DB_PORT_DEFAULT,
    database: dbName,
    user: role,
    password,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await cli.connect();
    await cli.query("SELECT 1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try {
      await cli.end();
    } catch {
      /* already closed */
    }
  }
}

async function tenants() {
  const all = await registry.listActiveTenants();
  return SLUG ? all.filter((t) => t.slug === SLUG) : all;
}

async function cmdStatus() {
  const list = await tenants();
  const rows = [];
  for (const t of list) {
    rows.push({
      slug: t.slug,
      db: t.db_name,
      app_role: t.app_role || "(shared)",
      own_credential: await dbCredentials.hasOwnCredential(t.slug),
      secret_ref: t.secret_ref || "(none)",
    });
  }
  if (JSON_OUT) return console.warn(JSON.stringify(rows, null, 2));

  const w = Math.max(6, ...rows.map((r) => r.slug.length));
  console.warn(`${"tenant".padEnd(w)}  own cred  role`);
  console.warn("-".repeat(w + 30));
  for (const r of rows) {
    console.warn(
      `${r.slug.padEnd(w)}  ${(r.own_credential ? "yes" : "NO ").padEnd(8)}  ${r.app_role}`,
    );
  }
  const pending = rows.filter((r) => !r.own_credential).length;
  console.warn(
    `\n${rows.length - pending}/${rows.length} on their own credential` +
      (pending ? ` — ${pending} still sharing DB_PASSWORD` : ""),
  );
}

async function cmdBackfill(rotate) {
  const list = await tenants();
  let done = 0;
  let skipped = 0;
  for (const t of list) {
    if (!rotate && (await dbCredentials.hasOwnCredential(t.slug))) {
      skipped++;
      continue;
    }
    process.stderr.write(`  ${t.slug} ... `);
    try {
      const res = await ensureTenantRole(t.slug, t.db_name, { rotate });
      // Drop the live pool so the next request rebuilds it on the new
      // credential; without this the running process keeps the old password.
      dbCredentials.invalidate(t.slug);
      await registry.invalidatePool(t.db_name);
      console.warn(`ok (${res.role})`);
      done++;
    } catch (err) {
      console.warn(`FAILED — ${err.message}`);
    }
  }
  console.warn(`\n${done} provisioned, ${skipped} already had one.`);
}

/**
 * Close the platform database to PUBLIC.
 *
 * Postgres grants CONNECT on every database to PUBLIC, so a freshly created
 * tenant role can open the PLATFORM database — the tenant registry, the secret
 * vault, `platform_setting` — even though it has no table grants there. It can
 * still read the system catalogues and enumerate every tenant, host and role.
 *
 * This is deliberately NOT done automatically during provisioning: revoking
 * PUBLIC on the platform DB breaks any role that reaches it only through PUBLIC,
 * which is a deployment-shaped question. So it is an explicit operator action
 * that names the roles to keep, and re-grants them in the same transaction.
 *
 *   node scripts/db/tenant-credentials.js --lock-platform
 *   node scripts/db/tenant-credentials.js --lock-platform --keep=reporting,etl
 */
async function cmdLockPlatform() {
  const keep = new Set(
    [config.DB_USER, config.TENANT_DB_SUPERUSER, ...String(val("keep") || "").split(",")]
      .map((r) => String(r || "").trim())
      .filter(Boolean),
  );
  const cli = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.TENANT_DB_SUPERUSER,
    password: config.TENANT_DB_SUPERUSER_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });
  await cli.connect();
  try {
    await cli.query("BEGIN");
    await cli.query(`REVOKE CONNECT ON DATABASE "${config.DB_NAME}" FROM PUBLIC`);
    for (const role of keep) {
      const { rows } = await cli.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
      if (rows.length === 0) {
        console.warn(`  skip ${role} — no such role`);
        continue;
      }
      await cli.query(`GRANT CONNECT ON DATABASE "${config.DB_NAME}" TO "${role}"`);
      console.warn(`  kept ${role}`);
    }
    await cli.query("COMMIT");
    console.warn(
      `\nPlatform database "${config.DB_NAME}" is closed to PUBLIC. ` +
        "Re-run --verify to confirm no tenant role can reach it.",
    );
  } catch (err) {
    await cli.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await cli.end();
  }
}

/**
 * The negative test. A per-tenant credential that still opens other tenant
 * databases is not isolation, just extra rows — so this asserts both halves.
 */
async function cmdVerify() {
  const all = await registry.listActiveTenants();
  const list = SLUG ? all.filter((t) => t.slug === SLUG) : all;
  const results = [];
  let breaches = 0;

  for (const t of list) {
    if (!(await dbCredentials.hasOwnCredential(t.slug))) {
      results.push({ slug: t.slug, skipped: "no own credential (backfill pending)" });
      continue;
    }
    const cred = await dbCredentials.resolveCredential(t);
    if (cred.source !== "vault") {
      results.push({ slug: t.slug, skipped: "credential did not resolve from vault" });
      continue;
    }
    const role = tenantRoleName(t.slug);

    // Does the REGISTRY agree with the vault about who this password belongs to?
    //
    // This check exists because its absence caused an outage. The pool takes its
    // username from `tenant_database.app_role` and its password from the vault;
    // an earlier backfill wrote the password without repointing app_role, so
    // every pool authenticated as the old deploy-wide role with the new role's
    // password and failed instantly. This script reported "isolation verified"
    // throughout, because it connected as `role` DIRECTLY and never exercised
    // what the application actually does.
    //
    // A verification that does not use the production code path is not a
    // verification of the production code path.
    const appPathMismatch = cred.user !== role;

    // Connect the way the APP will — with the resolved user, not the assumed one.
    const own = await tryConnect(cred.user, cred.password, t.db_name);
    const foreign = [];
    for (const other of all) {
      if (other.db_name === t.db_name) continue;
      const r = await tryConnect(role, cred.password, other.db_name);
      if (r.ok) {
        foreign.push(other.db_name);
        breaches++;
      }
    }

    // On a single-tenant deployment the loop above has nothing to iterate, so
    // "no foreign database reachable" would be vacuously true and this whole
    // check would report success while proving nothing. The PLATFORM database
    // always exists and a tenant role has no business opening it, so it is the
    // one foreign target that makes this assertion real from the first tenant.
    const platformReach = await tryConnect(role, cred.password, config.DB_NAME);
    if (platformReach.ok) {
      foreign.push(`${config.DB_NAME} (platform)`);
      breaches++;
    }

    if (!own.ok) breaches++;
    if (appPathMismatch) breaches++;
    results.push({
      slug: t.slug,
      role,
      resolved_user: cred.user,
      app_path_mismatch: appPathMismatch
        ? `tenant_database.app_role is "${cred.user}" but the vaulted credential belongs to "${role}" — the app will fail to authenticate. Re-run --backfill to repair.`
        : null,
      own_db: own.ok ? "connected" : `FAILED — ${own.error}`,
      foreign_dbs_reachable: foreign,
    });
  }

  if (JSON_OUT) {
    console.warn(JSON.stringify({ breaches, results }, null, 2));
  } else {
    for (const r of results) {
      if (r.skipped) {
        console.warn(`${r.slug}: skipped — ${r.skipped}`);
        continue;
      }
      const bad = r.foreign_dbs_reachable.length;
      console.warn(
        `${r.slug} (${r.role}): own=${r.own_db}; foreign reachable=${bad ? r.foreign_dbs_reachable.join(",") : "none"}`,
      );
      if (r.app_path_mismatch) console.warn(`  MISCONFIGURED — ${r.app_path_mismatch}`);
    }
    console.warn(
      breaches
        ? `\nISOLATION BREACH — ${breaches} failure(s). A tenant credential opens a database it must not.`
        : "\nIsolation verified: every credential opens its own database and no other.",
    );
  }
  return breaches === 0;
}

(async () => {
  try {
    if (has("--verify")) {
      const ok = await cmdVerify();
      process.exitCode = ok ? 0 : 1;
    } else if (has("--lock-platform")) {
      await cmdLockPlatform();
    } else if (has("--backfill") || has("--rotate")) {
      await cmdBackfill(has("--rotate"));
    } else {
      await cmdStatus();
    }
  } catch (err) {
    console.warn(`error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await registry.closeAll().catch(() => {});
    const platformDb = require("../../src/services/platform/db");
    await platformDb.close().catch(() => {});
  }
})();
