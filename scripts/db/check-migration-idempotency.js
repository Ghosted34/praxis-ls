#!/usr/bin/env node
/**
 * Guard: every NEW migration is safe to run twice, and no APPLIED migration is
 * ever edited.
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 *
 * Two migrations were written with the same number (`0090_a`, `0090_b`). One
 * was renamed to `0100_b` to resolve the collision. The next migrate run failed
 * with "relation already exists", "index already exists", "trigger already
 * exists".
 *
 * THE RENAME WAS THE CAUSE, NOT THE DDL. The ledger is
 * `public.schema_migration(scope, filename)` — keyed on the relative FILENAME
 * (see src/services/platform/migrator.js). Rename the file and the ledger stops
 * matching, so the migrator sees a brand-new migration and runs it against a
 * database that already has everything in it.
 *
 * That is worth stating plainly because it changes what "fix it" means:
 * idempotent DDL makes the SYMPTOM harmless, it does not remove the cause. Use
 * `scripts/db/mark-migration-applied.js` for a legitimate rename.
 *
 * ── WHY IDEMPOTENCY IS STILL WORTH ENFORCING ────────────────────────────────
 *
 * Because a rename is not the only way a file gets re-run:
 *
 *   - A migration that fails PART WAY leaves the ledger row unwritten (the DDL
 *     and the row commit together — DATA 3.1), so the whole file re-runs after
 *     the fix. Every statement before the failure runs a second time.
 *   - `provision-tenant` applies the full set to a database that may already
 *     have some objects from a partial run.
 *   - CI applies the tenant set TWICE on purpose, to test the ledger.
 *
 * ── AND WHY IDEMPOTENCY IS ALSO A HAZARD, WHICH IS THE OTHER HALF ───────────
 *
 * `CREATE TABLE IF NOT EXISTS` silently skips a table whose definition CHANGED.
 * That is not hypothetical here — audit DATA 3.3: `notification_preference` was
 * CREATEd in two files with different columns, both with IF NOT EXISTS, the
 * earlier one won, and `created_at` exists on no database despite 0472
 * declaring it. Nothing read the column, so nothing broke. That is exactly what
 * made it dangerous.
 *
 * So this gate does TWO things, and the second is what stops the first from
 * becoming a liability:
 *
 *   1. NEW migrations must be idempotent (rules below).
 *   2. BASELINED migrations must not change, byte for byte.
 *
 * Rule 2 is the drift guard. Once a migration has run somewhere, editing it
 * changes what a fresh database gets and NOT what an existing one has — the two
 * silently diverge, and `IF NOT EXISTS` guarantees nobody finds out. A changed
 * definition belongs in a NEW migration. Always.
 *
 * ── WHAT IS NOT RETRO-FITTED ────────────────────────────────────────────────
 *
 * The 127 files that existed when this landed are baselined as-is, for the same
 * reason check-migration-reversibility.js grandfathers its own: rewriting a
 * migration that has already run in production is a bigger risk than the one
 * being fixed. `--report` lists which grandfathered files would fail, so the
 * backlog is visible rather than forgotten.
 *
 * Usage:
 *   node scripts/db/check-migration-idempotency.js              # CI gate
 *   node scripts/db/check-migration-idempotency.js --report     # show backlog
 *   node scripts/db/check-migration-idempotency.js --update-baseline
 *
 * Exits 1 on any violation.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");

/**
 * Test seams. A guard script has to be provable, and the only honest proof is
 * running the real thing over a tree containing a known-bad migration — which
 * must not mean writing one into `migrations/` and hoping the cleanup lands.
 * (It did not: the first version of the test left a file behind on a mount that
 * refuses unlink.)
 *
 * Unset in every real invocation, including CI.
 */
const MIGRATIONS = process.env.PRAXIS_MIGRATIONS_DIR || path.join(ROOT, "migrations");
const BASELINE = process.env.PRAXIS_IDEMPOTENCY_BASELINE
  || path.join(__dirname, "migration-idempotency-baseline.json");
const SCOPES = ["platform", "tenant", "seeds"];

/* ── SQL text handling ───────────────────────────────────────────────────────
 * Comments are stripped before matching. Migrations in this repo carry long
 * explanatory headers and commented-out `-- DOWN` blocks full of
 * `DROP TABLE ...` — matching those would flag every reversible migration for a
 * statement that is deliberately inert.
 */
function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => m); // keep $$ bodies: DO blocks matter
}

/** Body of every DO $$ ... $$ block — statements inside are operator-guarded. */
function doBlockRanges(sql) {
  const ranges = [];
  const re = /\bDO\s+(\$[A-Za-z0-9_]*\$)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tag = m[1];
    const end = sql.indexOf(tag, m.index + m[0].length);
    if (end === -1) break;
    ranges.push([m.index, end + tag.length]);
    re.lastIndex = end + tag.length;
  }
  return ranges;
}

const inRanges = (i, ranges) => ranges.some(([a, b]) => i >= a && i < b);

/**
 * The rules.
 *
 * `guardable` means Postgres offers a native IF NOT EXISTS / OR REPLACE for it.
 * Anything else has to be wrapped in a DO block with a catalog check — there is
 * no `ADD CONSTRAINT IF NOT EXISTS` and no `CREATE TYPE IF NOT EXISTS`, which
 * is the single most common reason a migration is not actually rerunnable.
 */
const RULES = [
  {
    id: "create-table",
    find: /\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE TABLE IF NOT EXISTS",
  },
  {
    id: "create-index",
    find: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY)/gi,
    fix: "CREATE INDEX IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS",
  },
  {
    id: "add-column",
    find: /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "ADD COLUMN IF NOT EXISTS",
  },
  {
    id: "drop-anything",
    find: /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER|FUNCTION|TYPE|COLUMN|CONSTRAINT|SCHEMA|SEQUENCE|POLICY)\s+(?!IF\s+EXISTS)/gi,
    fix: "DROP <object> IF EXISTS",
  },
  {
    id: "create-schema",
    find: /\bCREATE\s+SCHEMA\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE SCHEMA IF NOT EXISTS",
  },
  {
    id: "create-extension",
    find: /\bCREATE\s+EXTENSION\s+(?!IF\s+NOT\s+EXISTS)/gi,
    fix: "CREATE EXTENSION IF NOT EXISTS",
  },
  {
    id: "create-function",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)(?:FUNCTION|PROCEDURE)\b/gi,
    fix: "CREATE OR REPLACE FUNCTION / PROCEDURE",
  },
  {
    id: "create-view",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)(?:MATERIALIZED\s+)?VIEW\b/gi,
    fix: "CREATE OR REPLACE VIEW  (materialized: DROP MATERIALIZED VIEW IF EXISTS first)",
  },
  {
    // PG14+ has CREATE OR REPLACE TRIGGER; the deployment is pgvector/pg16.
    id: "create-trigger",
    find: /\bCREATE\s+(?!OR\s+REPLACE\s+)TRIGGER\b/gi,
    fix: "CREATE OR REPLACE TRIGGER  (or DROP TRIGGER IF EXISTS first)",
  },
  {
    // No native guard exists. Must be inside a DO block that checks pg_constraint.
    id: "add-constraint",
    find: /\bADD\s+CONSTRAINT\b/gi,
    fix: "wrap in DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='…') THEN … END IF; END $$;",
    requiresDoBlock: true,
  },
  {
    // Likewise — CREATE TYPE has no IF NOT EXISTS in any Postgres version.
    id: "create-type",
    find: /\bCREATE\s+TYPE\b/gi,
    fix: "wrap in DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='…') THEN … END IF; END $$;",
    requiresDoBlock: true,
  },
  {
    // A seed re-run without a conflict target double-inserts silently — the
    // failure mode migrator.js calls out by name.
    id: "insert-without-conflict",
    find: /\bINSERT\s+INTO\b/gi,
    fix: "add ON CONFLICT DO NOTHING (or DO UPDATE SET …)",
    statementNeeds: /\bON\s+CONFLICT\b/i,
  },
];

/** Line number of a character offset, for a useful error message. */
const lineOf = (sql, index) => sql.slice(0, index).split("\n").length;

/**
 * The statement a match belongs to — from the previous `;` to the next one.
 * Used by rules that are satisfied elsewhere in the same statement
 * (`INSERT … ON CONFLICT`), where a file-wide search would pass an unguarded
 * insert because some other insert in the file happened to be guarded.
 */
function statementAt(sql, index) {
  const start = sql.lastIndexOf(";", index) + 1;
  const end = sql.indexOf(";", index);
  return sql.slice(start, end === -1 ? sql.length : end);
}

function violations(sql) {
  const clean = stripSql(sql);
  const blocks = doBlockRanges(clean);
  const out = [];

  for (const rule of RULES) {
    rule.find.lastIndex = 0;
    let m;
    while ((m = rule.find.exec(clean)) !== null) {
      const insideDo = inRanges(m.index, blocks);

      // A DO block IS the guard. Anything inside one is the author's explicit
      // catalog check and is left alone.
      if (insideDo) continue;
      if (rule.requiresDoBlock) {
        out.push({ rule: rule.id, line: lineOf(clean, m.index), fix: rule.fix });
        continue;
      }
      if (rule.statementNeeds && rule.statementNeeds.test(statementAt(clean, m.index))) continue;

      out.push({ rule: rule.id, line: lineOf(clean, m.index), fix: rule.fix });
    }
  }
  return out;
}

/**
 * Fingerprint a migration's CONTENT — line endings normalised first.
 *
 * Without the normalisation this guard is platform-dependent, which is worse
 * than having no guard. Git checks these files out as CRLF on a Windows
 * developer machine (`core.autocrlf`) and as LF on Linux, so the same commit
 * hashes two different ways: CI passes, the Windows checkout reports 62 applied
 * migrations as "EDITED", and none of them were touched. A check that cries wolf
 * on one platform is a check that gets re-baselined to silence it — at which
 * point it starts crying wolf on the other, and then it gets deleted.
 *
 * `\r\n` → `\n` is the whole fix, and it needs no re-baseline: the committed
 * baseline already holds LF hashes.
 *
 * The durable complement is a `.gitattributes` carrying `*.sql text eol=lf`, so
 * the bytes stop diverging in the first place. That is a separate change because
 * it rewrites every SQL file in a working copy.
 */
const sha = (s) =>
  crypto.createHash("sha256").update(String(s).replace(/\r\n/g, "\n"), "utf8").digest("hex").slice(0, 16);

function allFiles() {
  const out = [];
  for (const scope of SCOPES) {
    const dir = path.join(MIGRATIONS, scope);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const rel = `${scope}/${f}`;
      out.push({ rel, abs: path.join(dir, f), sql: fs.readFileSync(path.join(dir, f), "utf8") });
    }
  }
  return out;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

function writeBaseline(files) {
  const hashes = {};
  for (const f of files) hashes[f.rel] = sha(f.sql);
  fs.writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        _comment:
          "Migrations already applied somewhere when the idempotency gate landed. "
          + "Files listed here are GRANDFATHERED from the idempotency rules and FROZEN: "
          + "their content must not change, because editing an applied migration makes a "
          + "fresh database differ from an existing one silently (audit DATA 3.3). "
          + "A changed definition goes in a NEW migration. Regenerate ONLY when "
          + "deliberately accepting a new file into the grandfathered set.",
        generated: new Date().toISOString().slice(0, 10),
        files: hashes,
      },
      null,
      2,
    )}\n`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const files = allFiles();

  if (args.includes("--update-baseline")) {
    writeBaseline(files);
    console.warn(`Baseline written: ${files.length} migrations frozen and grandfathered.`);
    return 0;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(
      "No baseline found. Run:\n  node scripts/db/check-migration-idempotency.js --update-baseline\n"
      + "…once, to record the migrations that already existed. New files are gated from then on.",
    );
    return 1;
  }

  const known = baseline.files || {};
  const edited = [];
  const offending = [];
  const backlog = [];

  for (const f of files) {
    const wasBaselined = Object.prototype.hasOwnProperty.call(known, f.rel);
    const v = violations(f.sql);

    if (wasBaselined) {
      if (known[f.rel] !== sha(f.sql)) edited.push(f.rel);
      if (v.length) backlog.push({ rel: f.rel, count: v.length });
      continue;
    }
    if (v.length) offending.push({ rel: f.rel, v });
  }

  if (args.includes("--report")) {
    console.warn(`Grandfathered migrations that are NOT idempotent: ${backlog.length}/${Object.keys(known).length}`);
    for (const b of backlog.sort((a, b2) => b2.count - a.count)) {
      console.warn(`  ${String(b.count).padStart(3)}  ${b.rel}`);
    }
    console.warn("\nThese are not gated — retro-fitting an applied migration is riskier than the bug.");
    return 0;
  }

  let failed = false;

  if (edited.length) {
    failed = true;
    console.error(
      `\n${edited.length} APPLIED migration(s) were EDITED.\n\n`
      + "A migration that has run somewhere is immutable. Editing it changes what a\n"
      + "FRESH database gets and not what an existing one has — the two diverge, and\n"
      + "IF NOT EXISTS guarantees nobody finds out (audit DATA 3.3).\n\n"
      + "A changed definition goes in a NEW migration.\n",
    );
    for (const e of edited) console.error(`  ${e}`);
    console.error(
      "\nIf the change is deliberate AND the file has never run anywhere, re-baseline:\n"
      + "  node scripts/db/check-migration-idempotency.js --update-baseline\n",
    );
  }

  if (offending.length) {
    failed = true;
    console.error(
      `\n${offending.length} new migration(s) are not safe to run twice.\n\n`
      + "A migration re-runs more often than people expect: a file that fails part way\n"
      + "leaves its ledger row unwritten and the WHOLE file runs again after the fix;\n"
      + "provision-tenant replays the set; CI applies the tenant set twice on purpose.\n",
    );
    for (const o of offending) {
      console.error(`\n  ${o.rel}`);
      for (const x of o.v) console.error(`    line ${String(x.line).padEnd(5)} ${x.rule}\n      → ${x.fix}`);
    }
    console.error(
      "\nSee doc/BUILD_CONVENTIONS.md § Migrations for the DO-block patterns.\n"
      + "NOTE: idempotent DDL does NOT make a RENAMED migration safe — the ledger keys\n"
      + "on filename. For a rename use scripts/db/mark-migration-applied.js.\n",
    );
  }

  if (failed) return 1;

  console.warn(
    `Migration idempotency OK — ${files.length - Object.keys(known).length} new file(s) checked, `
    + `${Object.keys(known).length} grandfathered and frozen`
    + (backlog.length ? ` (${backlog.length} carry a known backlog — --report)` : "")
    + ".",
  );
  return 0;
}

process.exit(main());
