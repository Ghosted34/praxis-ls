"use strict";

/**
 * Rewriting a column into a NEW vocabulary must drop the OLD check first.
 *
 * ── THE FAILURE THIS PINS ──────────────────────────────────────────────────
 *
 * 13801 shipped with this, in this order:
 *
 *     UPDATE dossier_reconciliation SET status = 'OPEN' WHERE status IN (...);
 *     ALTER TABLE dossier_reconciliation
 *       DROP CONSTRAINT IF EXISTS dossier_reconciliation_status_check;
 *
 * 10715 had declared that CHECK inline, so Postgres auto-named it
 * `<table>_<column>_check`, and it permits only DRAFT/SUBMITTED/VALIDATED/
 * REJECTED. Setting a row to 'OPEN' while it is still in force raises 23514 and
 * rolls the whole migration back:
 *
 *     Failed applying tenant/13801_budget_reconciliation.sql [sandbox]:
 *       new row for relation "dossier_reconciliation"
 *       violates check constraint "dossier_reconciliation_status_check"
 *
 * ── WHY NOTHING ELSE CATCHES IT ────────────────────────────────────────────
 *
 * Because the failure needs pre-existing ROWS, and every gate we have starts
 * from none. CI's `migrations` job provisions a FRESH tenant, so both UPDATEs
 * match zero rows, no row is ever checked, and the file passes. It passed CI,
 * passed on the `live` schema (also empty) — and failed on `sandbox`, the one
 * schema carrying demo data. The deploy was the first thing in the chain with
 * rows in it, which is the worst possible place to find out.
 *
 * `npm run ci` cannot see it either: it runs no database at all.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 *   If a migration DROPs a constraint whose name contains a column name, every
 *   UPDATE of that column in that file must come AFTER the drop.
 *
 * Keyed on the column appearing in the constraint NAME because that is
 * Postgres's own auto-naming convention for an inline CHECK — `<table>_<col>_check`
 * — and inline is how every constraint this rule is about was declared.
 *
 * Deliberately narrow. `0515_corporate_entity_rich.sql` updates
 * `accounting_framework` and separately drops `corporate_entity_no_self_parent`,
 * which governs a different column entirely; a broader "any UPDATE before any
 * DROP CONSTRAINT" rule flags it, and a gate that cries wolf gets deleted.
 */

const fs = require("fs");
const path = require("path");

const DIRS = ["migrations/tenant", "migrations/platform", "migrations/seeds"].map((d) =>
  path.join(__dirname, "..", "..", d),
);

/** Comments carry example DDL and prose; only executable SQL counts. */
const stripComments = (sql) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

/**
 * Offences in one file: an UPDATE of a column that a later DROP CONSTRAINT in
 * the same file names.
 */
function scan(sql) {
  const code = stripComments(sql);

  // Every constraint dropped, with the offset it is dropped at.
  const drops = [];
  for (const m of code.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)/gi,
  )) {
    drops.push({ table: m[1].toLowerCase(), name: m[2].toLowerCase(), at: m.index });
  }
  if (!drops.length) return [];

  const offences = [];
  for (const m of code.matchAll(/UPDATE\s+(\w+)\s+SET\s+(\w+)\s*=/gi)) {
    const table = m[1].toLowerCase();
    const column = m[2].toLowerCase();
    for (const d of drops) {
      // Same table, the constraint's name names this column, and the drop comes
      // LATER in the file than the write.
      if (d.table === table && d.name.includes(column) && d.at > m.index) {
        offences.push(`${table}.${column} rewritten before "${d.name}" is dropped`);
      }
    }
  }
  return [...new Set(offences)];
}

describe("a column is not rewritten while its old CHECK is still in force", () => {
  const files = [];
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      files.push({ label: `${path.basename(dir)}/${f}`, full: path.join(dir, f) });
    }
  }

  it("has files to check, so this does not pass vacuously", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [f.label, f.full]))("%s", (label, full) => {
    const offences = scan(fs.readFileSync(full, "utf8"));
    const message = offences.length
      ? `${label} rewrites a column before dropping the constraint that governs it:\n` +
        offences.map((o) => `  · ${o}`).join("\n") +
        "\n\nThe UPDATE raises 23514 on any database that already has rows, and " +
        "\nrolls the whole migration back. A fresh tenant has none, so CI and the " +
        "\nlive schema can both pass while a populated one fails — see this test's " +
        "\nheader and 13801.\n\nMove the DROP CONSTRAINT above the UPDATE."
      : "";
    expect(offences.length ? message : "").toBe("");
  });

  it("catches the shape it exists for, and leaves the unrelated one alone", () => {
    // The 13801 regression, in miniature.
    expect(
      scan(
        "UPDATE t SET status = 'OPEN';\nALTER TABLE t DROP CONSTRAINT IF EXISTS t_status_check;",
      ),
    ).toEqual(['t.status rewritten before "t_status_check" is dropped']);

    // Correct order — nothing to report.
    expect(
      scan(
        "ALTER TABLE t DROP CONSTRAINT IF EXISTS t_status_check;\nUPDATE t SET status = 'OPEN';",
      ),
    ).toEqual([]);

    // A constraint on a DIFFERENT column is not this rule's business — the
    // 0515_corporate_entity_rich.sql case, which a broader rule would flag.
    expect(
      scan(
        "UPDATE corporate_entity SET accounting_framework = 'OHADA';\n" +
          "ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS corporate_entity_no_self_parent;",
      ),
    ).toEqual([]);

    // A different TABLE is not this rule's business either.
    expect(
      scan("UPDATE a SET status = 'X';\nALTER TABLE b DROP CONSTRAINT IF EXISTS b_status_check;"),
    ).toEqual([]);
  });
});
