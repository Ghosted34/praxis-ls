#!/usr/bin/env node
/**
 * Gate: a migration must not guard `ADD CONSTRAINT` on `conname` alone.
 *
 *   node scripts/db/check-constraint-guards.js
 *   node scripts/db/check-constraint-guards.js --report   # list the frozen set
 *
 * ── THE BUG THIS PREVENTS ─────────────────────────────────────────────────
 *
 * `pg_constraint` is DATABASE-wide and `conname` is unique per TABLE, so
 *
 *     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_x')
 *       THEN ALTER TABLE t ADD CONSTRAINT chk_x ...
 *
 * matches that name on ANY schema's copy of the table. A tenant database has
 * `live` and `sandbox`, migrated in that order, so live creates the constraint
 * and sandbox then finds LIVE's row, takes the branch as false, and skips its
 * own ADD. Nothing raises. The audit behind 13791 measured 111 constraints lost
 * from sandbox this way, across 48 migrations and roughly two years.
 *
 * `check-schema-parity.js` catches the SYMPTOM, but only in the one CI job that
 * has a provisioned tenant, and only after the fact. This catches the CAUSE, in
 * the file, at the moment somebody writes it — which is the difference between
 * a five-second fix and a corrective migration.
 *
 * ── THE SHAPE THAT IS CORRECT ─────────────────────────────────────────────
 *
 *     IF NOT EXISTS (
 *       SELECT 1
 *         FROM pg_constraint c
 *         JOIN pg_class t      ON t.oid = c.conrelid
 *         JOIN pg_namespace n  ON n.oid = t.relnamespace
 *        WHERE c.conname = 'chk_x'
 *          AND t.relname = 'the_table'
 *          AND n.nspname = current_schema()
 *     ) THEN ...
 *
 * ── WHY THE OLD FILES ARE FROZEN RATHER THAN FIXED ────────────────────────
 *
 * Editing them would repair nothing and break something. `appliedSet` keys the
 * ledger on FILENAME, so an edited file already recorded is skipped on every
 * existing tenant — only brand-new tenants would see it. And `contentDrift`
 * compares each applied file's sha256 against the ledger, so editing 48 applied
 * files reports the entire fleet as content-drifted, turning a real alarm into
 * noise. 13791 repairs the data instead; these stay exactly as they were
 * applied, and the baseline below records that this is deliberate.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DIRS = ["migrations/tenant", "migrations/platform", "migrations/seeds"];

/**
 * The files that carried the bug before it was understood. Frozen, not fixed —
 * see the header. A file may only leave this list, never join it.
 */
const FROZEN = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, "constraint-guards.baseline.json"), "utf8"))
    .frozen,
);

/** A guard block gating an ADD CONSTRAINT on an unqualified pg_constraint read. */
const GUARD = /IF NOT EXISTS\s*\(\s*SELECT[^)]*?FROM\s+pg_constraint\s+WHERE\s+conname[\s\S]*?END IF/gi;

/**
 * Strip `--` comments before matching.
 *
 * Not fussiness: the first version of this gate flagged 13791 — the migration
 * that FIXES the bug — because its header quotes the broken pattern to explain
 * it. A gate that punishes a file for documenting the defect it repairs teaches
 * people to stop documenting.
 *
 * Erring toward false NEGATIVES on purpose. A `--` inside a string literal
 * would truncate that line and could hide a finding; the runtime gate
 * (`check-schema-parity.js`) still catches anything that slips through, whereas
 * a false positive here blocks a correct migration with a confusing message.
 */
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");

function offenders() {
  const out = [];
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith(".sql")).sort()) {
      const rel = `${dir}/${f}`;
      // The DOWN section at the foot of a file restates old DDL in comments;
      // it never runs, so it is not a finding.
      const body = stripComments(
        fs.readFileSync(path.join(abs, f), "utf8").split("-- VERIFY")[0],
      );
      const names = [];
      for (const block of body.match(GUARD) || []) {
        for (const m of block.matchAll(/ADD CONSTRAINT (\w+)/g)) names.push(m[1]);
      }
      if (names.length) out.push({ file: rel, names });
    }
  }
  return out;
}

const found = offenders();

if (process.argv.includes("--report")) {
  console.log(`${found.length} file(s) carry an unqualified constraint guard:\n`);
  for (const o of found) {
    console.log(`  ${FROZEN.has(o.file) ? "frozen " : "NEW    "} ${o.file}  (${o.names.length})`);
  }
  process.exit(0);
}

const fresh = found.filter((o) => !FROZEN.has(o.file));
const healed = [...FROZEN].filter((f) => !found.some((o) => o.file === f));

if (fresh.length) {
  console.error(
    `\n✗ ${fresh.length} migration(s) guard ADD CONSTRAINT on conname alone.\n\n` +
      `  pg_constraint is DATABASE-wide, so this matches the constraint on the OTHER\n` +
      `  schema's copy of the table. live migrates before sandbox, so sandbox finds\n` +
      `  live's row and silently skips its own ADD — 111 constraints were lost this\n` +
      `  way before anyone noticed (see 13791).\n\n` +
      `  Join pg_class and pg_namespace and match n.nspname = current_schema().\n`,
  );
  for (const o of fresh) console.error(`    ${o.file}: ${o.names.join(", ")}`);
  console.error("");
  process.exit(1);
}

// A frozen file that no longer matches has been rewritten — which the header
// argues against. Say so rather than silently accepting a shrinking baseline.
if (healed.length) {
  console.error(
    `\n✗ ${healed.length} frozen migration(s) no longer carry the guard they were frozen for.\n\n` +
      `  Editing an applied migration does not re-run it (the ledger keys on\n` +
      `  filename) and DOES trip contentDrift across the fleet. If this was\n` +
      `  deliberate, remove the entry from constraint-guards.baseline.json and say\n` +
      `  why in the commit.\n`,
  );
  for (const f of healed) console.error(`    ${f}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Constraint guards OK — no new unqualified pg_constraint guard ` +
    `(${FROZEN.size} frozen, repaired by 13791).`,
);
