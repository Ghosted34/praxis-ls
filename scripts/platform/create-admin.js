#!/usr/bin/env node
/**
 * Create (or update) a Platform Root Admin — needed to log into the company
 * dashboard. Password hashed with Argon2id.
 *   node scripts/platform/create-admin.js --email=you@jbspraxis.com --name="You" --password=secret
 */
"use strict";

const argon2 = require("argon2");
const platformDb = require("../../src/services/platform/db");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

(async () => {
  if (!a.email || !a.password) {
    throw new Error("--email and --password are required");
  }
  const hash = await argon2.hash(a.password, { type: argon2.argon2id });
  const { rows } = await platformDb.query(
    "INSERT INTO platform.platform_user (email, full_name, role, password_hash) " +
      "VALUES ($1,$2,'PLATFORM_ROOT_ADMIN',$3) " +
      "ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, password_hash=EXCLUDED.password_hash, is_active=true " +
      "RETURNING platform_user_id, email, role",
    [a.email, a.name || a.email, hash],
  );
  console.log(`[praxis] platform admin ready: ${rows[0].email} (${rows[0].role})`);
  await platformDb.close();
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] create-admin FAILED:", e.message);
    process.exit(1);
  });
