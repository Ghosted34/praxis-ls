"use strict";
/**
 * 12745 — the weekly query's source value and its dedicated index.
 *
 * Read as SQL text rather than run, like 10740's test: these two statements are
 * the ONLY thing standing between "one weekly query per person per week" and an
 * unbounded pile of duplicates, and both failure modes are silent. A migration
 * that forgot the CHECK value fails every weekly insert at runtime; one that
 * forgot the index fails nothing and simply stops deduplicating.
 */

const fs = require("fs");
const path = require("path");

describe("12745 weekly query source + index", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../../migrations/tenant/12745_hr_query_weekly_source.sql"),
    "utf8",
  );

  it("admits WEEKLY to the source CHECK without dropping 0704's three", () => {
    expect(sql).toMatch(/CHECK \(source IN \('MANUAL','CLOCK_IN','RECONCILE','WEEKLY'\)\)/);
    // Re-added rather than left alongside: two CHECKs on one column would both
    // have to pass, and the old one refuses 'WEEKLY'.
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS ck_hr_query_source/);
  });

  it("creates a partial unique index on (employee_id, work_date) for WEEKLY only", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_query_weekly_week/);
    expect(sql).toMatch(/ON hr_query \(employee_id, work_date\)/);
    expect(sql).toMatch(/WHERE source = 'WEEKLY'/);
  });

  it("does not touch the daily index, which the weekly row stays out of", () => {
    // The weekly row carries hr_rule_id = NULL precisely so it falls out of
    // ux_hr_query_auto_day's `hr_rule_id IS NOT NULL` predicate. Altering that
    // index here would be solving the collision at the wrong end.
    expect(sql).not.toMatch(/DROP INDEX IF EXISTS ux_hr_query_auto_day/);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX[^;]*ux_hr_query_auto_day/);
  });

  it("carries a reversal", () => {
    expect(sql).toMatch(/-- DOWN/);
    expect(sql).toMatch(/-- DROP INDEX IF EXISTS ux_hr_query_weekly_week;/);
  });
});
