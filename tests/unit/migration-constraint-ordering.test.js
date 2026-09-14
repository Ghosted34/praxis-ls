"use strict";

/**
 * A constraint added to a PRE-EXISTING table above 13791 breaks a fresh tenant.
 *
 * ── THE FAILURE THIS PINS ──────────────────────────────────────────────────
 *
 * `provisioning.service.js` migrates `for (const schema of ["live","sandbox"])`
 * — every file against live, THEN every file against sandbox. 13791 repairs
 * sandbox by mirroring the constraints it finds in live, so when it runs in the
 * SANDBOX pass it sees live at the head of the migration list while sandbox is
 * only at 13791. It guards that the TABLE exists in the target; it does not
 * guard that the COLUMN does, and its exception handler catches
 * check_violation and foreign_key_violation but not undefined_column:
 *
 *     Failed applying tenant/13791_sandbox_constraint_repair.sql [sandbox]:
 *       column "attachment_kind" does not exist
 *
 * That is a red `migrations` job, and only a red `migrations` job — it needs a
 * live Postgres, so `npm run ci` cannot see it and neither can any other gate
 * here. It cost one CI cycle on the first migration since 13791 that tried
 * (13794); this test is so it costs zero on the next.
 *
 * ── WHY THE FIX IS NOT "EDIT 13791" ───────────────────────────────────────
 *
 * Its own header explains: `contentDrift` compares each applied file's sha256
 * against the ledger, so editing a file that has already run reports every
 * tenant in the fleet as content-drifted and turns a real alarm into permanent
 * noise. A later migration cannot help either — 13791 aborts provisioning
 * before one could run.
 *
 * ── SO THE RULE IS ────────────────────────────────────────────────────────
 *
 *   A NEW table may carry any constraint it likes. 13791 skips a table that is
 *   absent from the target, so a table created by the same migration is never
 *   its business.
 *
 *   An EXISTING table may only gain PLAIN columns. Enforce the rule that would
 *   have been a CHECK in the validator and the service instead, and say so
 *   where the column is declared.
 *
 * Column DEFAULTs and NOT NULL are both fine: 13791 copies only contype 'c'
 * and 'f', and on PG16 a NOT NULL lives in `pg_attribute`, not `pg_constraint`.
 */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "..", "migrations", "tenant");

/**
 * The repair migration. Files at or below it predate the hazard — they ran
 * before 13791 in both passes, so their constraints are already in sandbox by
 * the time it looks.
 */
const REPAIR = 13791;

const numberOf = (file) => Number.parseInt(file.slice(0, file.indexOf("_")), 10);

/** Comments carry example DDL and prose; only executable SQL counts. */
const stripComments = (sql) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

function scan(sql) {
  const code = stripComments(sql);
  const created = new Set(
    [...code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)].map((m) => m[1].toLowerCase()),
  );
  const offences = [];
  for (const statement of code.split(";")) {
    const m = statement.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
    if (!m) continue;
    const table = m[1].toLowerCase();
    // A table this same file creates is invisible to 13791 in the target.
    if (created.has(table)) continue;
    if (/\bADD\s+CONSTRAINT\b/i.test(statement)) offences.push(`${table} — ADD CONSTRAINT`);
    else if (/\bCHECK\s*\(/i.test(statement)) offences.push(`${table} — inline CHECK`);
    else if (/\bREFERENCES\b/i.test(statement)) offences.push(`${table} — inline REFERENCES`);
  }
  return offences;
}

describe("migrations above 13791 must not constrain a pre-existing table", () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && Number.isFinite(numberOf(f)))
    .filter((f) => numberOf(f) > REPAIR);

  it("has files to check, so this does not pass vacuously", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s adds no CHECK or foreign key to an existing table", (file) => {
    const offences = scan(fs.readFileSync(path.join(DIR, file), "utf8"));
    const message =
      offences.length
        ? `${file} constrains a table it did not create:\n` +
          offences.map((o) => `  · ${o}`).join("\n") +
          "\n\nThis aborts provisioning a new tenant at 13791 — see the header of" +
          "\nthis test, and of 13794, for why and for what to do instead."
        : "";
    expect(offences.length ? message : "").toBe("");
  });

  it("still recognises a constraint on a table the file DID create", () => {
    // The carve-out is the load-bearing half: without it every new table would
    // be flagged, the rule would be unusable, and somebody would delete it.
    expect(scan("CREATE TABLE IF NOT EXISTS t (id uuid);\nALTER TABLE t ADD COLUMN k text CHECK (k IN ('A'));")).toEqual([]);
    expect(scan("ALTER TABLE existing ADD COLUMN k text CHECK (k IN ('A'));")).toEqual([
      "existing — inline CHECK",
    ]);
    expect(scan("ALTER TABLE existing ADD COLUMN r uuid REFERENCES other(id);")).toEqual([
      "existing — inline REFERENCES",
    ]);
    // A default and a NOT NULL are not constraints 13791 copies.
    expect(scan("ALTER TABLE existing ADD COLUMN k text NOT NULL DEFAULT 'VAULT';")).toEqual([]);
  });
});
