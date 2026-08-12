"use strict";
/**
 * Reconcile what the code believes `dossier` looks like against what the
 * migrations actually declare — and check that every literal payload the two
 * dossier-opening call sites build names real columns.
 *
 * WHY THIS TEST EXISTS
 *
 * `dossier` had no `title` column. 0310 created the table without one and the
 * only ALTER before 0508 (0479) adds pol_place_id/pod_place_id. Two services
 * passed `title: opp.name` anyway:
 *
 *   src/orchestration/handlers/opportunity-won-open-dossier.js
 *   src/modules/sales/opportunity/opportunity.service.js   (win({createDossier}))
 *
 * `insertOne` builds its column list from `Object.keys(data)` and validates each
 * key as an IDENTIFIER — which `title` is. It has no idea what columns the table
 * has, so the key reached Postgres and came back 42703. The synchronous path
 * 500ed; the event path dead-lettered silently. The sales→operations handoff had
 * never worked by either route.
 *
 * Nothing caught it because nothing could: the unit suites fake the client, and
 * a fake accepts any column name you hand it. It surfaced the first time the
 * integration job ran against a real Postgres (TC-CI6).
 *
 * So this test does the one thing a faked client cannot — it reads the SCHEMA.
 * No database required, which is the point: it fails in the fast suite, at the
 * moment the mismatch is written, not in an integration job someone may not run.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "migrations", "tenant");

const { WRITABLE } = require("../../src/modules/operations/operations_file/operations_file.repo");

/** Columns set by the database or by `touch`, never by a caller's payload. */
const NOT_WRITABLE = new Set(["dossier_id", "created_at", "updated_at"]);

/**
 * Strip SQL comments before scanning.
 *
 * NOT optional here, and the first version of this reader got it wrong. Every
 * migration in this tree documents its own rollback in a comment — 0508's says
 * `-- ALTER TABLE dossier DROP COLUMN IF EXISTS title;` — so a scanner that
 * reads comments sees a DROP that never executes and concludes the column does
 * not exist. It reported `title` phantom on a migration that adds it.
 *
 * Blanking rather than deleting keeps line and offset structure intact, so the
 * CREATE TABLE body still splits into the same lines.
 */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * Every column `dossier` has, read from the migrations in filename order.
 *
 * Text scanning, not a SQL parser: these are the shapes this schema uses and
 * each is unambiguous. A migration that adds a column some other way would show
 * up here as a MISSING column — a visible failure asking for this reader to be
 * taught the new shape, which is the safe direction to be wrong in.
 */
function columnsOfDossier() {
  const cols = new Set();
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));

    // CREATE TABLE dossier ( ... );  — take the body up to the closing paren.
    const created = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?dossier\s*\(([\s\S]*?)\n\)\s*;/i);
    if (created) {
      for (const line of created[1].split("\n")) {
        const bare = line.replace(/--.*$/, "").trim();
        // A column definition opens with the name; a table constraint opens
        // with a keyword. Skip the latter.
        if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(bare)) continue;
        const m = bare.match(/^([a-z_][a-z0-9_]*)\s+\S/i);
        if (m) cols.add(m[1]);
      }
    }

    // ALTER TABLE dossier ADD COLUMN [IF NOT EXISTS] <name> …[, ADD COLUMN …];
    //
    // Read the WHOLE statement, not just its first clause. Postgres takes a
    // comma-separated list of actions in one ALTER TABLE, and 0660 adds nine
    // columns that way — only the first of which follows the literal text
    // "ALTER TABLE dossier ADD COLUMN". Matching per-clause instead of
    // per-statement reported the other eight as phantom columns, which is the
    // "teach the reader the new shape" failure this function's header predicts.
    for (const stmt of sql.matchAll(/ALTER\s+TABLE\s+dossier\b([\s\S]*?);/gi)) {
      for (const m of stmt[1].matchAll(
        /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        cols.add(m[1]);
      }
    }

    // The same, inside a DO block: EXECUTE 'ALTER TABLE dossier ADD COLUMN x t'
    for (const m of sql.matchAll(
      /EXECUTE\s+'ALTER\s+TABLE\s+dossier\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      cols.add(m[1]);
    }

    // Same shape for drops — a multi-clause ALTER can drop several at once.
    for (const stmt of sql.matchAll(/ALTER\s+TABLE\s+dossier\b([\s\S]*?);/gi)) {
      for (const m of stmt[1].matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        cols.delete(m[1]);
      }
    }
  }
  return cols;
}

/** Keys of the object literal passed as `data:` to a dossier create call. */
function dataKeysIn(relPath) {
  const src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const at = src.indexOf("data: {");
  if (at === -1) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = src.slice(open + 1, end);
  return [...body.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*:/gi)].map((m) => m[1]);
}

describe("dossier columns: code vs schema", () => {
  const schema = columnsOfDossier();

  it("reads the dossier table out of the migrations at all", () => {
    // Guards the reader itself. If the regexes stop matching, every other
    // assertion below passes vacuously against an empty set — which is exactly
    // the "check that cannot fail" failure this remediation keeps finding.
    expect(schema.size).toBeGreaterThan(15);
    expect(schema.has("dossier_id")).toBe(true);
    expect(schema.has("ref")).toBe(true);
  });

  it("has the title column two services have always written to (0508)", () => {
    expect(schema.has("title")).toBe(true);
  });

  it("declares no writable column the schema does not have", () => {
    const phantom = [...WRITABLE].filter((c) => !schema.has(c));
    expect(phantom).toEqual([]);
  });

  it("leaves no schema column unaccounted for", () => {
    // Either writable, or deliberately not. A new column that is neither is a
    // decision nobody has made yet.
    const unaccounted = [...schema].filter((c) => !WRITABLE.has(c) && !NOT_WRITABLE.has(c));
    expect(unaccounted).toEqual([]);
  });
});

describe("dossier create payloads name real columns", () => {
  const schema = columnsOfDossier();

  const CALL_SITES = [
    "src/orchestration/handlers/opportunity-won-open-dossier.js",
    "src/modules/sales/opportunity/opportunity.service.js",
  ];

  it.each(CALL_SITES)("%s", (relPath) => {
    const keys = dataKeysIn(relPath);
    // A null here means the `data: {` literal moved or was inlined; failing is
    // right, because the test would otherwise silently stop covering the file.
    expect(keys).not.toBeNull();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !schema.has(k))).toEqual([]);
    expect(keys.filter((k) => !WRITABLE.has(k))).toEqual([]);
  });

  it("still carries the opportunity name across the handoff", () => {
    // The alternative fix was to delete `title:` from both call sites, which
    // would have made the flow work and lost the deal name at the one boundary
    // where Operations needs to know what the job is. Migration 0508 chose the
    // column instead; this asserts the choice, so a later "cleanup" that drops
    // the argument has to argue with a test rather than pass silently.
    for (const relPath of CALL_SITES) {
      expect(dataKeysIn(relPath)).toContain("title");
    }
  });
});
