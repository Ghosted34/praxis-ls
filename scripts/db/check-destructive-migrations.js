#!/usr/bin/env node
/**
 * OBS-I3 — refuse a destructive migration unless someone has said, in the file,
 * that they meant it.
 *
 * `deploy.sh` runs `docker compose run --rm migrate` against EVERY tenant
 * database before the app rolls. The convention is "keep migrations additive"
 * (DEPLOYMENT.md) and nothing enforced it: `check-migration-numbers.js`
 * validates numbering, `check-migration-reversibility.js` validates that a
 * `-- DOWN` block exists. Neither reads what the SQL does.
 *
 * So a `DROP COLUMN` that passes review reaches production data on every
 * tenant, at once, with no down path (DI-3.5 grandfathers the 99 pre-existing
 * migrations) and — until the pre-deploy backup landed — nothing to restore
 * from. The backup exists now, which turns this from unrecoverable into
 * expensive; this check is the part that stops it happening by accident.
 *
 * NOT A BAN. Destructive migrations are sometimes correct, and a gate that
 * forbids them outright gets worked around. It requires an explicit marker on
 * the same line or the line above:
 *
 *     -- DESTRUCTIVE: dropping legacy_ref, unused since 0480, verified empty
 *     ALTER TABLE dossier DROP COLUMN legacy_ref;
 *
 * The marker is the point. It forces the author to write down what is being
 * destroyed and why, puts that sentence in the diff where a reviewer sees it,
 * and leaves it in the file for whoever is restoring a backup at 02:00.
 *
 * SCOPE: only files not yet recorded as applied are worth failing on, but this
 * has no database access, so it checks every migration and relies on the
 * grandfather list below for the ones that already shipped. A file that is
 * already applied cannot be un-applied by editing it (the migrator keys the
 * ledger on filename), so failing on those would be noise nobody can act on.
 *
 * Exits 1 on an unmarked destructive statement.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const DIRS = [
  path.join(ROOT, "migrations", "tenant"),
  path.join(ROOT, "migrations", "platform"),
  path.join(ROOT, "migrations", "seeds"),
];

/**
 * Statements that destroy data or make it unreachable.
 *
 * `DROP TABLE`/`DROP COLUMN` are obvious. The others are here because they fail
 * LOUDLY at apply time on data that does not fit — which on a per-tenant
 * migrator means the run stops partway through the estate, leaving tenants on
 * different schema versions. That is the failure this file exists to prevent as
 * much as the data loss itself.
 *
 * `DROP … IF EXISTS` on an INDEX, TRIGGER, FUNCTION or CONSTRAINT is not
 * matched: those are recreated by the same migrations that drop them (0505 does
 * exactly this), they destroy no rows, and matching them would make the marker
 * meaningless through sheer frequency.
 */
const PATTERNS = [
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bDROP\s+SCHEMA\b/i, "DROP SCHEMA"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bALTER\s+COLUMN\s+\w+\s+TYPE\b/i, "ALTER COLUMN … TYPE (rewrites, can fail on existing data)"],
  [/\bSET\s+NOT\s+NULL\b/i, "SET NOT NULL (fails if any existing row is null)"],
  [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
];

const MARKER = /--\s*DESTRUCTIVE:/i;

/**
 * Files that already shipped before this check existed. Editing them cannot
 * un-apply them — the migrator keys its ledger on filename — so failing on them
 * would be a permanent red light nobody can turn off.
 *
 * Anything NEW must carry the marker. Do not add to this list; add the marker.
 */
const GRANDFATHERED = new Set([]);

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    // Line comments are blanked but KEPT as blanks, so line numbers survive and
    // the marker lookup below can still read the original text.
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

function main() {
  const violations = [];

  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (GRANDFATHERED.has(name)) continue;
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      const rawLines = raw.split("\n");
      const codeLines = stripComments(raw).split("\n");

      codeLines.forEach((code, i) => {
        for (const [re, label] of PATTERNS) {
          if (!re.test(code)) continue;
          // The marker may sit on this line or the one above it.
          const marked = MARKER.test(rawLines[i] || "") || MARKER.test(rawLines[i - 1] || "");
          if (!marked) {
            violations.push({ file: path.relative(ROOT, path.join(dir, name)), line: i + 1, label, text: rawLines[i].trim().slice(0, 100) });
          }
        }
      });
    }
  }

  if (!violations.length) {
    // `process.stdout.write`, not console.warn: the lint config allows only
    // console.warn/error, and this gate's own output should not be the thing
    // that pushes the warning ceiling up (TC-CI10).
    process.stdout.write("Migrations: no unmarked destructive statements.\n");
    return 0;
  }

  for (const v of violations) {
    console.error(`::error file=${v.file},line=${v.line}::${v.label} with no "-- DESTRUCTIVE:" marker — ${v.text}`);
  }
  console.error(
    `\n${violations.length} unmarked destructive statement(s). These run against EVERY tenant database `
    + "before the app rolls, and this repo has no down-migrations for anything before 0500.\n"
    + 'If it is intended, say so in the file:\n\n'
    + "    -- DESTRUCTIVE: <what is lost, and why that is acceptable>\n",
  );
  return 1;
}

process.exit(main());
