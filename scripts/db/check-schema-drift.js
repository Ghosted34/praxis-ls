#!/usr/bin/env node
/**
 * Catch the class of drift that produced DATA 3.3: the same table defined more
 * than once, with different columns, where `IF NOT EXISTS` silently picks a
 * winner by filename order.
 *
 * WHAT HAPPENED
 *
 * `notification_preference` is created in both `0440_settings_gaps.sql` and
 * `0472_notification_preference.sql`. Both use `CREATE TABLE IF NOT EXISTS`.
 * 0440 sorts first, so it wins, and `created_at` — declared in 0472 — exists on
 * no database anywhere. 0472's `CREATE INDEX IF NOT EXISTS` still ran, so the
 * index IS there: the file half-applied and reported success.
 *
 * Nothing read the column, so nothing broke. That is what makes it dangerous
 * rather than harmless. The migration files stopped being a faithful
 * description of the schema, silently, and the tooling could not tell. The next
 * person reads 0472, writes code against `created_at`, and finds out on a
 * customer's database.
 *
 * WHY THIS IS A STATIC CHECK AND NOT A LIVE COMPARISON
 *
 * Comparing files against a live database needs a database, credentials, and a
 * choice of WHICH tenant is authoritative — and would only catch drift after it
 * shipped. This reads the migration files alone and answers a question that is
 * decidable from them: does any table get defined twice with a different column
 * set? That is checkable on every PR, before anything runs.
 *
 * The live half is covered separately by the CI migrations job, which applies
 * the whole set to a real Postgres.
 *
 *   node scripts/db/check-schema-drift.js
 *
 * Exit 1 on a conflicting redefinition.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DIRS = ["migrations/tenant", "migrations/platform"];

const CREATE_TABLE =
  /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

/** Column names declared in a CREATE TABLE body, ignoring table constraints. */
function columnsOf(body) {
  const cols = [];
  let depth = 0;
  let line = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      cols.push(line);
      line = "";
      continue;
    }
    line += ch;
  }
  cols.push(line);

  const out = [];
  for (const raw of cols) {
    const t = raw.replace(/--[^\n]*/g, "").trim();
    if (!t) continue;
    const first = (t.split(/\s+/)[0] || "").toUpperCase();
    if (["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "EXCLUDE", "LIKE"].includes(first)) {
      continue;
    }
    const m = t.match(/^(\w+)\s+\S/);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

/**
 * Keyed by "<database>.<table>", NOT by table name alone.
 *
 * `migrations/tenant` and `migrations/platform` build SEPARATE DATABASES, so a
 * table appearing in both is not drift — it is two different tables that share
 * a name. A first version of this check compared globally and reported four
 * conflicts, three of which were exactly that (ai_vendor_credential, ai_document
 * and ai_chunk all exist in both, deliberately and with different shapes). A
 * check that is wrong three times out of four is a check that gets deleted.
 */
const defs = new Map(); // "<scope>.<table>" -> [{ file, columns }]
const altered = new Map(); // "<scope>.<table>" -> Set(columns added by a later ALTER)

const ADD_COLUMN = /ALTER\s+TABLE\s+(?:\w+\.)?(\w+)\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/gi;

for (const dir of DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  const scope = path.basename(dir); // "tenant" | "platform"
  for (const name of fs.readdirSync(abs).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(abs, name), "utf8");
    for (const m of sql.matchAll(CREATE_TABLE)) {
      const key = `${scope}.${m[2].toLowerCase()}`;
      if (!defs.has(key)) defs.set(key, []);
      defs.get(key).push({ file: `${dir}/${name}`, columns: columnsOf(m[3]) });
    }
    // A later ALTER … ADD COLUMN is how drift is CORRECTLY resolved: the
    // conflicting CREATE TABLE files must not be edited, because editing an
    // applied migration changes nothing on a database that already ran it.
    // Without this, the check would stay red forever after the real fix landed
    // — and a permanently-red check is one people learn to ignore.
    for (const m of sql.matchAll(ADD_COLUMN)) {
      const key = `${scope}.${m[1].toLowerCase()}`;
      if (!altered.has(key)) altered.set(key, new Set());
      altered.get(key).add(m[2].toLowerCase());
    }
  }
}

const conflicts = [];
for (const [table, list] of defs) {
  if (list.length < 2) continue;
  const [first, ...rest] = list;
  for (const other of rest) {
    const a = new Set(first.columns);
    const b = new Set(other.columns);
    const fixed = altered.get(table) || new Set();
    const onlyFirst = first.columns.filter((c) => !b.has(c) && !fixed.has(c));
    const onlyOther = other.columns.filter((c) => !a.has(c) && !fixed.has(c));
    if (onlyFirst.length || onlyOther.length) {
      conflicts.push({ table, first, other, onlyFirst, onlyOther });
    }
  }
}

const redefined = [...defs.entries()].filter(([, l]) => l.length > 1);

if (conflicts.length === 0) {
  console.warn(
    `Schema drift: ${defs.size} tables across ${DIRS.join(", ")} (compared per database); ` +
      `${redefined.length} defined more than once, none with conflicting columns.`,
  );
  process.exit(0);
}

console.warn(`${conflicts.length} table(s) redefined with DIFFERENT columns:\n`);
for (const c of conflicts) {
  console.warn(`  ${c.table}`);
  console.warn(`     ${c.first.file}  (wins — sorts first)`);
  console.warn(`     ${c.other.file}`);
  if (c.onlyOther.length) {
    console.warn(`     declared only in the LATER file, so never created: ${c.onlyOther.join(", ")}`);
  }
  if (c.onlyFirst.length) {
    console.warn(`     present only in the earlier file: ${c.onlyFirst.join(", ")}`);
  }
  console.warn("");
}
console.warn(`Both definitions use CREATE TABLE IF NOT EXISTS, so the earlier file wins and the
later one is a no-op that reports success. Any column it adds does not exist on
any database, and code written against the later file will fail at runtime.

Fix it with an additive ALTER in a NEW migration — see
migrations/tenant/0503_notification_preference_drift.sql — rather than editing
either file. Editing an applied migration changes nothing on a database that
already ran it.`);
process.exit(1);
