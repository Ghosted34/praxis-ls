#!/usr/bin/env node
/**
 * Compare a tenant's live `permission` grants against the seeded baseline, so
 * the damage from the matrix-pagination bug is findable without eyeballing a
 * 70-column grid.
 *
 * WHY. `GET /permissions` paginates at 50 rows. The grant matrix loaded every
 * role and every module but only the first page of grants, so a cell whose grant
 * fell below the cut rendered EMPTY — and clicking any permission on it PUT an
 * all-false row over whatever was actually stored. Anyone who used that screen
 * may have silently revoked grants they never touched. The screen is fixed
 * (`/permissions/matrix`), but existing damage is invisible until you look.
 *
 * The baseline is what `9021_seed_default_permissions.sql` + `9022` would grant
 * a fresh tenant. This reports:
 *
 *   MISSING   a baseline grant the tenant no longer has  ← the suspicious ones
 *   REDUCED   the row exists but a baseline flag is now false
 *   EXTRA     grants beyond the baseline — usually deliberate, listed for context
 *
 * A tenant that has legitimately tightened its own permissions will show MISSING
 * rows too; this can't tell intent apart from damage. It tells you where to look.
 *
 * Read-only. Never writes.
 *
 *   node scripts/tenant/permission-report.js --slug=smartls
 *   node scripts/tenant/permission-report.js --all
 *   node scripts/tenant/permission-report.js --slug=smartls --extras
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { config } = require("../../src/config/env");
const m = require("../../src/services/platform/migrator");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

const FLAGS = ["can_create", "can_read", "can_update", "can_delete", "can_approve"];
const SEEDS = ["9021_seed_default_permissions.sql", "9022_seed_grant_gaps.sql"];

/**
 * Parse the baseline out of the seed files.
 *
 * Both use the same shape — a VALUES list of (role_code, c, r, u, d, a) joined
 * to a CROSS JOIN VALUES list of module keys — so one parser covers them. 9022
 * also has plain `SELECT r.role_id, 'MOD-xx', false, true, ...  FROM role r`
 * (every role), handled separately.
 *
 * Parsing the seed rather than hardcoding it means this report can't drift from
 * what a fresh tenant actually gets.
 */
function parseBaseline() {
  const baseline = []; // { role_code|"*", module_key, flags{} }
  for (const file of SEEDS) {
    const p = path.join(__dirname, "..", "..", "migrations", "seeds", file);
    if (!fs.existsSync(p)) continue;
    const sql = fs.readFileSync(p, "utf8");

    // Statement-per-INSERT so a VALUES list is matched to its own module list.
    for (const stmt of sql.split(/;\s*\n/)) {
      if (!/INSERT INTO permission/i.test(stmt)) continue;

      const modules = [...stmt.matchAll(/CROSS JOIN \(VALUES([\s\S]*?)\) AS m/gi)]
        .flatMap((mm) => [...mm[1].matchAll(/'([A-Z0-9-]+)'/g)].map((x) => x[1]));

      const roleRows = [...stmt.matchAll(
        /\('([A-Z_]+)',\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false)\)/g,
      )];

      if (roleRows.length && modules.length) {
        for (const r of roleRows) {
          const flags = {
            can_create: r[2] === "true", can_read: r[3] === "true", can_update: r[4] === "true",
            can_delete: r[5] === "true", can_approve: r[6] === "true",
          };
          for (const mod of modules) baseline.push({ role_code: r[1], module_key: mod, flags });
        }
        continue;
      }

      // "every role" form: SELECT r.role_id, 'MOD-00A', false, true, false, false, false FROM role r
      const every = stmt.match(
        /SELECT\s+r\.role_id,\s*'([A-Z0-9-]+)',\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false)\s+FROM role r/i,
      );
      if (every) {
        baseline.push({
          role_code: "*",
          module_key: every[1],
          flags: {
            can_create: every[2] === "true", can_read: every[3] === "true", can_update: every[4] === "true",
            can_delete: every[5] === "true", can_approve: every[6] === "true",
          },
        });
      }
    }
  }
  return baseline;
}

async function listSlugs() {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const { rows } = await pf.query(
      "SELECT slug FROM platform.tenant WHERE status IN ('LIVE','PROVISIONING','SUSPENDED') ORDER BY slug",
    );
    return rows.map((r) => r.slug);
  } finally {
    await pf.end();
  }
}

async function run(slug, baseline) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    // Grants are identity data — always the live schema, whatever the toggle.
    await cli.query("SET search_path TO live, public");

    const { rows: roles } = await cli.query("SELECT role_id, code FROM role");
    const byCode = new Map(roles.map((r) => [r.code, r.role_id]));
    const codeOf = new Map(roles.map((r) => [r.role_id, r.code]));

    const { rows: grants } = await cli.query("SELECT * FROM permission");
    const held = new Map(grants.map((g) => [`${g.role_id}::${g.module_key}`, g]));

    // Expand "*" to every role that exists in this tenant.
    const expected = baseline.flatMap((b) =>
      b.role_code === "*"
        ? roles.map((r) => ({ ...b, role_code: r.code }))
        : [b]);

    const missing = [];
    const reduced = [];
    for (const e of expected) {
      const roleId = byCode.get(e.role_code);
      if (!roleId) continue; // role deleted or renamed by the tenant
      const g = held.get(`${roleId}::${e.module_key}`);
      if (!g) {
        missing.push(`${e.role_code} × ${e.module_key}`);
        continue;
      }
      const lost = FLAGS.filter((f) => e.flags[f] && g[f] !== true);
      if (lost.length) reduced.push(`${e.role_code} × ${e.module_key}  lost ${lost.join(",")}`);
    }

    console.warn(`\n=== ${slug} ===`);
    console.warn(`  roles: ${roles.length}   grant rows: ${grants.length}   baseline rows: ${expected.length}`);

    if (!missing.length && !reduced.length) {
      console.warn("  ✓ every baseline grant is present and intact");
    }
    if (missing.length) {
      console.warn(`  ⚠️  ${missing.length} baseline grant(s) MISSING entirely:`);
      for (const x of missing) console.warn(`        ${x}`);
    }
    if (reduced.length) {
      console.warn(`  ⚠️  ${reduced.length} grant(s) REDUCED below baseline:`);
      for (const x of reduced) console.warn(`        ${x}`);
    }

    if (a.extras) {
      const expectedKeys = new Set(expected
        .filter((e) => byCode.get(e.role_code))
        .map((e) => `${byCode.get(e.role_code)}::${e.module_key}`));
      const extra = grants.filter((g) => !expectedKeys.has(`${g.role_id}::${g.module_key}`));
      console.warn(`  ${extra.length} grant(s) beyond baseline (usually deliberate):`);
      for (const g of extra) {
        const on = FLAGS.filter((f) => g[f]).map((f) => f.replace("can_", "")).join(",");
        console.warn(`        ${codeOf.get(g.role_id) || g.role_id} × ${g.module_key}  ${on || "(none set)"}`);
      }
    }
  } finally {
    await cli.end();
  }
}

async function main() {
  if (!a.slug && !a.all) throw new Error("--slug=<slug> or --all is required");
  const baseline = parseBaseline();
  if (!baseline.length) throw new Error("could not parse a baseline from the seed files");
  const slugs = a.all ? await listSlugs() : [a.slug];
  for (const slug of slugs) await run(slug, baseline);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] permission-report FAILED:", e.message);
    process.exit(1);
  });
