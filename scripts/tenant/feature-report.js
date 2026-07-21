#!/usr/bin/env node
/**
 * READ-ONLY feature-gate report — answers "why does this account get 403 on a
 * page it should obviously be able to see?"
 *
 * Two different things can 403 a request, and they look identical in the UI:
 *
 *   1. RBAC        — `requirePermission(MOD-xx, action)` (src/middleware/rbac.js).
 *                    The CEO role (role.code = 'CEO') BYPASSES this entirely.
 *   2. Feature gate — `requireFeature(key)` (src/middleware/feature-gate.js),
 *                    mounted IN FRONT of the whole router by module-loader.js.
 *                    NOTHING bypasses it — not the CEO, not the owner. If the
 *                    tenant's `feature_state` row isn't 'on', the module is dark
 *                    for every user in the tenant.
 *
 * So a CEO seeing "access denied" is almost always (2), not (1). This script
 * proves which, by cross-referencing what the mounted routes REQUIRE against
 * what the tenant's `feature_state` actually SAYS.
 *
 * Reads only — no INSERT/UPDATE anywhere. Safe to run against production.
 *
 *   node scripts/tenant/feature-report.js --slug=smartls [--env=live|sandbox|both]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { config } = require("../../src/config/env");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

const MODULES_DIR = path.join(__dirname, "..", "..", "src", "modules");

/**
 * Scan every `<group>/<module>/<module>.routes.js` for its `feature:` export.
 * We parse rather than require() so this runs without booting the app or its
 * DB pool. The loader only reads `basePath` and `feature` off the export, and
 * both are written as plain literals in all ~70 modules today.
 */
function scanModules() {
  const out = [];
  for (const group of fs.readdirSync(MODULES_DIR)) {
    const groupDir = path.join(MODULES_DIR, group);
    if (!fs.statSync(groupDir).isDirectory()) continue;
    for (const mod of fs.readdirSync(groupDir)) {
      const routesFile = path.join(groupDir, mod, `${mod}.routes.js`);
      if (!fs.existsSync(routesFile)) continue;
      const src = fs.readFileSync(routesFile, "utf8");
      const feature = /feature:\s*"([^"]+)"/.exec(src);
      const basePath = /basePath:\s*"([^"]+)"/.exec(src);
      out.push({
        group,
        module: mod,
        basePath: basePath ? basePath[1] : `/${mod}`,
        feature: feature ? feature[1] : null,
      });
    }
  }
  return out.sort((x, y) => (x.group + x.module).localeCompare(y.group + y.module));
}

async function resolveTenant(slug) {
  const platform = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
  });
  await platform.connect();
  try {
    const { rows } = await platform.query(
      `SELECT td.db_host, td.db_port, td.db_name, td.live_schema, td.sandbox_schema,
              t.tenant_id, p.code AS plan_code
       FROM platform.tenant t
       JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
       LEFT JOIN platform.plan p ON p.plan_id = t.plan_id
       WHERE t.slug = $1`,
      [slug],
    );
    if (rows.length === 0) throw new Error(`tenant '${slug}' not found`);
    return rows[0];
  } finally {
    await platform.end();
  }
}

async function readFeatureState(td, schema) {
  const cli = new Client({
    host: td.db_host,
    port: td.db_port,
    database: td.db_name,
    user: config.TENANT_DB_APP_ROLE || config.DB_USER,
    password: config.DB_PASSWORD,
  });
  await cli.connect();
  try {
    await cli.query(`SET search_path = ${schema}, public`);
    const { rows } = await cli.query(
      "SELECT feature_key, state, source, projected_at FROM feature_state ORDER BY feature_key",
    );
    return new Map(rows.map((r) => [String(r.feature_key), r]));
  } finally {
    await cli.end();
  }
}

function report(schema, modules, state) {
  const gated = modules.filter((m) => m.feature);
  const blocked = [];
  const missing = [];
  const open = [];

  for (const m of gated) {
    const row = state.get(m.feature);
    if (!row) missing.push(m);
    else if (row.state !== "on") blocked.push({ ...m, source: row.source });
    else open.push(m);
  }

  console.warn(`\n${"=".repeat(72)}`);
  console.warn(`SCHEMA: ${schema}`);
  console.warn("=".repeat(72));
  console.warn(
    `${modules.length} modules mounted · ${modules.length - gated.length} ungated · ` +
      `${open.length} gated+ON · ${blocked.length} gated+OFF · ${missing.length} gated+NO ROW`,
  );

  if (blocked.length) {
    console.warn(`\n--- DARK: feature exists but is OFF (403 FEATURE_DISABLED for EVERYONE incl. CEO) ---`);
    for (const m of blocked) {
      console.warn(`  ${m.basePath.padEnd(28)} ${m.feature.padEnd(30)} (${m.group}/${m.module}, source=${m.source})`);
    }
  }
  if (missing.length) {
    console.warn(`\n--- DARK: no feature_state row at all (never projected → treated as off) ---`);
    for (const m of missing) {
      console.warn(`  ${m.basePath.padEnd(28)} ${m.feature.padEnd(30)} (${m.group}/${m.module})`);
    }
  }

  // Dependency coherence: a child feature on while its parent is off is a
  // projection bug — depends_on lives in platform.feature_catalogue but nothing
  // enforces it when projecting into the tenant.
  const orphans = [];
  for (const [k, row] of state) {
    if (row.state !== "on") continue;
    const parent = k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : null;
    if (parent && state.has(parent) && state.get(parent).state !== "on") {
      orphans.push(`${k} is ON but its parent ${parent} is OFF`);
    }
  }
  if (orphans.length) {
    console.warn(`\n--- INCOHERENT: child feature on, parent off ---`);
    for (const o of orphans) console.warn(`  ${o}`);
  }

  if (!blocked.length && !missing.length) {
    console.warn(`\nEvery gated module is ON in ${schema}. If a page still 403s here, it is RBAC`);
    console.warn(`(a missing permission row), not the feature gate — check the permission matrix.`);
  }
  return { blocked: blocked.length, missing: missing.length };
}

async function main() {
  if (!a.slug) throw new Error("--slug is required (e.g. --slug=smartls)");
  const envArg = a.env || "both";
  const td = await resolveTenant(a.slug);
  const modules = scanModules();

  console.warn(`\nTenant '${a.slug}' · db=${td.db_name} · plan=${td.plan_code || "(none)"}`);
  console.warn(
    `NOTE: plan inclusion is NOT the same as 'on'. provisioning.service.js projects\n` +
      `      state = feature_catalogue.default_state whenever the plan includes the\n` +
      `      feature, so a full-plan tenant still inherits every default_state='off'.`,
  );

  const schemas =
    envArg === "live"
      ? [td.live_schema || "live"]
      : envArg === "sandbox"
        ? [td.sandbox_schema || "sandbox"]
        : [td.live_schema || "live", td.sandbox_schema || "sandbox"];

  let dark = 0;
  for (const schema of schemas) {
    const state = await readFeatureState(td, schema);
    const r = report(schema, modules, state);
    dark += r.blocked + r.missing;
  }

  if (dark) {
    console.warn(`\n${"=".repeat(72)}`);
    console.warn(`To turn one on for THIS tenant only (platform DB, then re-project):`);
    console.warn(`  INSERT INTO platform.tenant_feature_override (tenant_id, feature_key, state)`);
    console.warn(`  VALUES ('${td.tenant_id}', '<feature_key>', 'on')`);
    console.warn(`  ON CONFLICT (tenant_id, feature_key) DO UPDATE SET state = EXCLUDED.state;`);
    console.warn(`Then re-run provisioning's projectFeatures for the tenant.`);
    console.warn(`To change it for ALL tenants, edit default_state in`);
    console.warn(`  migrations/seeds/9110_seed_platform_features.sql, re-run the seed, re-project.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] feature-report FAILED:", e.message);
    process.exit(1);
  });
