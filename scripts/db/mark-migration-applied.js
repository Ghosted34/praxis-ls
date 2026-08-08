#!/usr/bin/env node
/**
 * Reconcile the migration ledger after a migration file is RENAMED.
 *
 * ── THE PROBLEM THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `public.schema_migration(scope, filename)` keys on the relative FILENAME
 * (src/services/platform/migrator.js). So renaming a migration that has already
 * run — resolving a number collision, fixing a typo in a slug — makes the
 * ledger stop matching. The next migrate run sees a brand-new file and applies
 * it to a database that already has everything in it:
 *
 *     relation "error_event" already exists
 *     index "ux_error_event_sig" already exists
 *     trigger "trg_error_event_updated" already exists
 *
 * Idempotent DDL hides that, but it does not fix it — and it does nothing at
 * all for a file containing a seed INSERT or an `ALTER … ADD COLUMN` backfill,
 * which re-runs silently and wrongly. The honest fix is to tell the ledger the
 * file has already been applied, under its new name.
 *
 * ── WHY THIS IS NOT JUST AN INSERT ──────────────────────────────────────────
 *
 * Marking a migration applied WITHOUT running it is a loaded gun: do it to a
 * file that genuinely never ran and the schema is missing objects that
 * everything downstream assumes exist, permanently, with the ledger insisting
 * all is well. That is strictly worse than the error it was meant to silence.
 *
 * So this refuses unless it can SEE the migration's effects in the catalog. It
 * parses the object names the file declares (tables, indexes, types, functions)
 * and checks they are present. All present → the file has clearly run under a
 * different name, marking it is bookkeeping. None present → it has not run, and
 * you want `migrate`, not this.
 *
 * A partial match is the interesting case and it stops too: that is a
 * half-applied migration, which needs a human, not a flag.
 *
 * Usage:
 *   node scripts/db/mark-migration-applied.js --scope=platform --file=platform/0100_b.sql
 *   node scripts/db/mark-migration-applied.js --scope=tenant --file=tenant/0530_x.sql --slug=smartls
 *   node scripts/db/mark-migration-applied.js ... --all-tenants
 *   node scripts/db/mark-migration-applied.js ... --force     # skip the catalog proof
 *   node scripts/db/mark-migration-applied.js ... --dry-run
 *
 * Scopes match the migrator's own: platform | tenant | tenant-seed | platform-seed.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { client, ensureLedger, MIGRATIONS, tenantDbName } = require("../../src/services/platform/migrator");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
}

/* ── What does this migration claim to create? ───────────────────────────────
 * Comments are stripped first: every migration here carries a commented-out
 * `-- DOWN` block full of DROP statements and a long prose header, and matching
 * those would look for objects the file deliberately does not create.
 */
function declaredObjects(sql) {
  const clean = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  const grab = (re) => {
    const out = [];
    let m;
    while ((m = re.exec(clean)) !== null) out.push(m[1].replace(/"/g, ""));
    return out;
  };
  return {
    tables: grab(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi),
    indexes: grab(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/gi),
    types: grab(/\bCREATE\s+TYPE\s+([A-Za-z0-9_."]+)/gi),
    functions: grab(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)/gi),
  };
}

const bare = (qualified) => {
  const parts = String(qualified).split(".");
  return { schema: parts.length > 1 ? parts[0] : null, name: parts[parts.length - 1] };
};

/** Which of the declared objects actually exist in this database? */
async function inspect(cli, declared) {
  const checks = [];

  for (const t of declared.tables) {
    const { schema, name } = bare(t);
    checks.push({
      kind: "table",
      label: t,
      sql: schema
        ? "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname=$1 AND n.nspname=$2 AND c.relkind='r'"
        : "SELECT 1 FROM pg_class WHERE relname=$1 AND relkind='r'",
      params: schema ? [name, schema] : [name],
    });
  }
  for (const i of declared.indexes) {
    const { name } = bare(i);
    checks.push({ kind: "index", label: i, sql: "SELECT 1 FROM pg_class WHERE relname=$1 AND relkind='i'", params: [name] });
  }
  for (const t of declared.types) {
    const { name } = bare(t);
    checks.push({ kind: "type", label: t, sql: "SELECT 1 FROM pg_type WHERE typname=$1", params: [name] });
  }
  for (const f of declared.functions) {
    const { name } = bare(f);
    checks.push({ kind: "function", label: f, sql: "SELECT 1 FROM pg_proc WHERE proname=$1", params: [name] });
  }

  const present = [];
  const missing = [];
  for (const c of checks) {

    const { rows } = await cli.query(c.sql, c.params);
    (rows.length ? present : missing).push(`${c.kind} ${c.label}`);
  }
  return { present, missing, total: checks.length };
}

async function markOne(dbName, { scope, file, force, dryRun }) {
  const cli = client(dbName);
  await cli.connect();
  try {
    await ensureLedger(cli);

    const { rows: already } = await cli.query(
      "SELECT applied_at FROM public.schema_migration WHERE scope=$1 AND filename=$2",
      [scope, file],
    );
    if (already.length) {
      console.warn(`  ${dbName}: already recorded (${already[0].applied_at.toISOString().slice(0, 10)}) — nothing to do`);
      return "skipped";
    }

    if (!force) {
      const declared = declaredObjects(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
      const { present, missing, total } = await inspect(cli, declared);

      if (total === 0) {
        console.error(
          `  ${dbName}: this file declares no tables, indexes, types or functions, so there is`
          + "\n           nothing to prove it ran. Re-run with --force if you are certain.",
        );
        return "refused";
      }
      if (present.length === 0) {
        console.error(
          `  ${dbName}: REFUSED — none of the ${total} object(s) this migration creates exist.`
          + "\n           That means it has NOT run here. Use `migrate`, not this.",
        );
        return "refused";
      }
      if (missing.length) {
        // The dangerous middle. Marking it applied freezes a half-built schema.
        console.error(`  ${dbName}: REFUSED — half-applied (${present.length}/${total} present). Missing:`);
        for (const m of missing) console.error(`             - ${m}`);
        console.error("           A human needs to finish or unwind this; a ledger row would hide it.");
        return "refused";
      }
      console.warn(`  ${dbName}: verified — all ${total} declared object(s) present`);
    }

    if (dryRun) {
      console.warn(`  ${dbName}: DRY RUN — would record ${scope} / ${file}`);
      return "dry";
    }

    await cli.query(
      "INSERT INTO public.schema_migration(scope, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [scope, file],
    );
    console.warn(`  ${dbName}: recorded ${scope} / ${file} ✓`);
    return "marked";
  } finally {
    await cli.end();
  }
}

async function main() {
  const scope = arg("scope");
  const file = arg("file");
  const slug = arg("slug");
  const allTenants = arg("all-tenants") === true;
  const force = arg("force") === true;
  const dryRun = arg("dry-run") === true;

  if (!scope || !file) {
    console.error(
      "Usage: node scripts/db/mark-migration-applied.js --scope=<platform|tenant|tenant-seed|platform-seed> --file=<scope/name.sql> [--slug=x | --all-tenants] [--force] [--dry-run]",
    );
    return 1;
  }

  const abs = path.join(MIGRATIONS, file);
  if (!fs.existsSync(abs)) {
    console.error(`No such migration: ${path.relative(ROOT, abs)}`);
    return 1;
  }

  console.warn(`\nMarking ${scope} / ${file} as applied${force ? " (FORCED — no catalog proof)" : ""}${dryRun ? " [dry run]" : ""}\n`);

  const results = [];
  if (scope === "platform" || scope === "platform-seed") {
    results.push(await markOne(require("../../src/config/env").config.DB_NAME, { scope, file, force, dryRun }));
  } else if (allTenants) {
    const registry = require("../../src/services/tenant/registry.service");
    const tenants = await registry.listActiveTenants();
    if (!tenants.length) console.warn("  (no active tenants)");
    for (const t of tenants) {

      results.push(await markOne(tenantDbName(t.slug), { scope, file, force, dryRun }));
    }
  } else if (slug) {
    results.push(await markOne(tenantDbName(slug), { scope, file, force, dryRun }));
  } else {
    console.error("A tenant scope needs --slug=<slug> or --all-tenants.");
    return 1;
  }

  const refused = results.filter((r) => r === "refused").length;
  console.warn(
    `\n${results.filter((r) => r === "marked").length} marked, `
    + `${results.filter((r) => r === "skipped").length} already recorded, ${refused} refused.\n`,
  );
  // A refusal is the tool working. Exit non-zero so a script does not carry on
  // believing the fleet is reconciled.
  return refused ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("mark-migration-applied FAILED:", e.message || e);
    process.exit(1);
  });
