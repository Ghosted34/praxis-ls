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

const SRC_DIR = path.join(__dirname, "..", "..", "src");
const MODULES_DIR = path.join(SRC_DIR, "modules");

/**
 * ── A MODULE-LEVEL `feature:` IS NOT THE ONLY GATE ──────────────────────────
 *
 * This script used to read only the `feature:` field off each module's route
 * export, which is what `module-loader.js` mounts `requireFeature` from. That
 * misses 58 gates.
 *
 * `src/modules/mail/` declares `feature: null` on all seven of its routers and
 * gates PER ROUTE instead — deliberately, and the reason is in
 * `mail.routes.js`: the same file carries PR-0's setup surface (connections,
 * mailboxes, catalogue, send points), and that MUST stay reachable while the
 * flags are off, or an admin cannot configure mail for the tenant they are
 * about to enable it for. `portal/` does the same for three routes.
 *
 * So this script — whose entire job is answering "why is this account getting a
 * 403 it should not" — was blind to every mail route in the product, and would
 * report a tenant with the whole mailbox dark as "every gated module is ON".
 * Both shapes are scanned now, and reported separately, because they fail
 * differently: a module-level gate takes the whole base path with it, a
 * route-level one takes a handful of endpoints and leaves the rest working.
 */
/**
 * `withFileTypes` rather than `readdirSync` + `statSync`.
 *
 * A `statSync` that decides whether to `readFileSync` is a check followed by a
 * use, with a window between them — CodeQL flags it, and correctly, even though
 * the worst case here is a diagnostic script throwing on a file that vanished
 * mid-scan. The `Dirent` carries the type from the SAME directory read, so there
 * is no second syscall and no window to lose the race in. It is also simply
 * fewer syscalls per file.
 *
 * `readFile` can still fail on its own — the file may go between the readdir and
 * the read — so it is guarded. A file this cannot open contributes no keys,
 * which is the same answer it would give for a file containing none. That is the
 * safe direction for THIS scan: `routeGatesIn` feeds the DARK ROUTES report, and
 * a missed gate under-reports what is dark rather than inventing one.
 */
function readIfPossible(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function routeGatesIn(dir, entries = null) {
  const keys = new Set();
  for (const e of entries || fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".js")) continue;
    for (const m of readIfPossible(path.join(dir, e.name)).matchAll(
      /requireFeature\(\s*"([^"]+)"/g,
    )) {
      keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

/**
 * Every dotted string literal anywhere in `src/`.
 *
 * Used only to decide whether a seeded key is INERT — checked by nothing at all
 * — as opposed to checked somewhere this script cannot model. Not every gate is
 * a `feature:` or a `requireFeature`: `mail.provider.oauth` is read straight
 * out of `feature_state` by `assertProviderEnabled` in mail.service.js, because
 * it gates a PROVIDER rather than a route.
 *
 * Deliberately loose — a key named only in a comment counts as referenced. A
 * false "this is fine" is a quiet diagnostic; a false "this gates nothing"
 * sends somebody hunting a defect that is not there.
 */
function keysMentionedInSrc() {
  const seen = new Set();
  // Same withFileTypes / guarded-read reasoning as routeGatesIn above. The
  // consequence of a missed file differs, though: this set is what decides a key
  // is INERT, so a file that cannot be read makes the report MORE likely to call
  // a live key inert. That is a false alarm rather than a false all-clear, which
  // is the direction this particular check should fail in.
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".js")) {
        for (const m of readIfPossible(p).matchAll(
          /"([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)"/g,
        )) {
          seen.add(m[1]);
        }
      }
    }
  })(SRC_DIR);
  return seen;
}

/**
 * Scan every `<group>/<module>/<module>.routes.js` for its `feature:` export,
 * and the whole module directory for per-route `requireFeature` calls.
 * We parse rather than require() so this runs without booting the app or its
 * DB pool. The loader only reads `basePath` and `feature` off the export, and
 * both are written as plain literals in all ~70 modules today.
 */
function scanModules() {
  const out = [];
  // `withFileTypes` throughout, and the module directory is listed ONCE — the
  // listing answers both "is there a routes file" and "which files does
  // routeGatesIn scan", so the existence check and the read are no longer a
  // check-then-use pair, and there is one readdir per module instead of two.
  for (const g of fs.readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!g.isDirectory()) continue;
    const groupDir = path.join(MODULES_DIR, g.name);
    for (const m of fs.readdirSync(groupDir, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      const modDir = path.join(groupDir, m.name);
      const entries = fs.readdirSync(modDir, { withFileTypes: true });
      const routesName = `${m.name}.routes.js`;
      // Membership in the listing, not a separate existsSync. A module without
      // its own routes file is not mounted and must stay out of the counts —
      // §3.2's landmine is that `mail/` is a GROUP, and its seven service-only
      // siblings are reached through a router that lives elsewhere.
      if (!entries.some((e) => e.isFile() && e.name === routesName)) continue;
      const src = readIfPossible(path.join(modDir, routesName));
      const feature = /feature:\s*"([^"]+)"/.exec(src);
      const basePath = /basePath:\s*"([^"]+)"/.exec(src);
      out.push({
        group: g.name,
        module: m.name,
        basePath: basePath ? basePath[1] : `/${m.name}`,
        feature: feature ? feature[1] : null,
        routeGates: routeGatesIn(modDir, entries),
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

function report(schema, modules, state, mentioned) {
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

  // Per-route gates — see routeGatesIn(). One module can carry several, and a
  // module with no module-level `feature:` can still be mostly dark.
  const routeRows = [];
  for (const m of modules) {
    for (const key of m.routeGates || []) {
      const row = state.get(key);
      routeRows.push({ m, key, state: row ? row.state : null, source: row ? row.source : null });
    }
  }
  const routeDark = routeRows.filter((r) => r.state !== "on");

  console.warn(`\n${"=".repeat(72)}`);
  console.warn(`SCHEMA: ${schema}`);
  console.warn("=".repeat(72));
  console.warn(
    `${modules.length} modules mounted · ${modules.length - gated.length} ungated · ` +
      `${open.length} gated+ON · ${blocked.length} gated+OFF · ${missing.length} gated+NO ROW`,
  );
  if (routeRows.length) {
    console.warn(
      `${routeRows.length} route-level gates across ` +
        `${new Set(routeRows.map((r) => `${r.m.group}/${r.m.module}`)).size} modules · ` +
        `${routeRows.length - routeDark.length} ON · ${routeDark.length} OFF or no row`,
    );
  }

  if (routeDark.length) {
    console.warn(`\n--- DARK ROUTES: some endpoints of a mounted module 403 (the rest still work) ---`);
    for (const r of routeDark) {
      console.warn(
        `  ${r.m.basePath.padEnd(28)} ${r.key.padEnd(30)} ` +
          `(${r.m.group}/${r.m.module}, ${r.state ? `state=${r.state}, source=${r.source}` : "NO ROW"})`,
      );
    }
  }

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

  // A flag that gates NOTHING is its own defect, and the expensive kind: the
  // console shows it, an operator flips it, and the product does not change.
  // Three mail keys shipped in exactly that state before this programme, and
  // the only reason anyone found out was a hand audit.
  const reachable = new Set();
  for (const m of modules) {
    if (m.feature) reachable.add(m.feature);
    for (const k of m.routeGates || []) reachable.add(k);
  }
  const inert = [...state.keys()].filter((k) => !reachable.has(k) && !mentioned.has(k));
  if (inert.length) {
    console.warn(`\n--- INERT: seeded into feature_state, checked by nothing in src/ ---`);
    console.warn(`  Flipping any of these changes no behaviour. Either wire it or drop the row.`);
    for (const k of inert.sort()) {
      console.warn(`  ${k.padEnd(34)} state=${state.get(k).state}`);
    }
  }

  if (!blocked.length && !missing.length && !routeDark.length) {
    console.warn(`\nEvery gate is ON in ${schema} — module-level and route-level both. If a page`);
    console.warn(`still 403s here, it is RBAC (a missing permission row), not the feature gate.`);
  }
  return { blocked: blocked.length, missing: missing.length, routeDark: routeDark.length };
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

  const mentioned = keysMentionedInSrc();

  let dark = 0;
  for (const schema of schemas) {
    const state = await readFeatureState(td, schema);
    const r = report(schema, modules, state, mentioned);
    dark += r.blocked + r.missing + r.routeDark;
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
