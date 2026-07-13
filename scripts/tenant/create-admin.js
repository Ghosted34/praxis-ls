#!/usr/bin/env node
/**
 * Bootstrap the first login for a tenant. Needed because provisioning
 * creates NO app_user rows and NO permission grants for any role (checked:
 * migrations/seeds/9020_seed_rbac_events.sql seeds `role`/`capability`/
 * `field_visibility` but zero `permission` rows) — a freshly provisioned
 * tenant has nobody who can log in, and even a manually-inserted user
 * would get 403 on every RBAC-gated endpoint. Mirrors
 * scripts/platform/create-admin.js's shape but at the tenant layer.
 *
 * Defaults to the 'CEO' role, which bypasses RBAC checks by design
 * (role.code = 'CEO' — see src/shared/cache/identity-cache.js /
 * src/middleware/rbac.js). That's intentional for the FIRST user: once
 * they can log in, they use the new `permission` module (this kickoff) to
 * grant scoped access to everyone else instead of making them all CEO.
 *
 *   node scripts/tenant/create-admin.js --slug=smartls \
 *     --email=you@example.com --name="You" --password=secret \
 *     [--role=CEO] [--env=live]
 */
"use strict";

const { Client } = require("pg");
const argon2 = require("argon2");
const { config } = require("../../src/config/env");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

async function main() {
  if (!a.slug || !a.email || !a.password) {
    throw new Error("--slug, --email and --password are required");
  }
  const role = a.role || "CEO";
  const env = a.env === "sandbox" ? "sandbox" : "live";

  const platform = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
  });
  await platform.connect();
  const { rows } = await platform.query(
    `SELECT td.db_host, td.db_port, td.db_name, td.live_schema, td.sandbox_schema
     FROM platform.tenant t
     JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
     WHERE t.slug = $1`,
    [a.slug],
  );
  await platform.end();
  if (rows.length === 0) throw new Error(`tenant '${a.slug}' not found — provision it first`);
  const td = rows[0];
  const schema = env === "sandbox" ? td.sandbox_schema || "sandbox" : td.live_schema || "live";

  const tenant = new Client({
    host: td.db_host,
    port: td.db_port,
    database: td.db_name,
    user: config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD,
  });
  await tenant.connect();
  await tenant.query(`SET search_path = ${schema}, public`);

  const hash = await argon2.hash(a.password, { type: argon2.argon2id });
  const { rows: userRows } = await tenant.query(
    `INSERT INTO app_user (email, full_name, password_hash, status)
     VALUES ($1,$2,$3,'ACTIVE')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'ACTIVE'
     RETURNING user_id`,
    [a.email, a.name || a.email, hash],
  );
  const userId = userRows[0].user_id;

  const { rows: roleRows } = await tenant.query(`SELECT role_id FROM role WHERE code = $1`, [role]);
  if (roleRows.length === 0) throw new Error(`role '${role}' not seeded in this tenant`);
  await tenant.query(
    `INSERT INTO user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [userId, roleRows[0].role_id],
  );

  await tenant.end();
  console.warn(`[praxis] tenant '${a.slug}' (${env}): ${a.email} ready with role ${role}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] tenant create-admin FAILED:", e.message);
    process.exit(1);
  });
