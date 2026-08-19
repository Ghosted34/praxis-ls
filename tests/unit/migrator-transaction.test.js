"use strict";

/**
 * applyTracked's transaction boundaries.
 *
 * The default (wrapTransaction=true) wraps EACH migration file in its own
 * BEGIN/COMMIT so the DDL and its ledger row commit together (DATA 3.1).
 *
 * The wipeSandbox path needs the OPPOSITE: it already holds one explicit
 * transaction around DROP SCHEMA → CREATE SCHEMA → re-apply, and Postgres has
 * no nested transactions. A BEGIN inside that transaction is only a warning,
 * but the next COMMIT commits the CALLER's transaction too — so a failure on
 * file #2+ left a partial schema (DROP committed, re-apply abandoned) while the
 * code claimed the old sandbox was preserved. With wrapTransaction=false the
 * caller's single COMMIT/ROLLBACK provides the atomicity.
 */

const path = require("path");
const m = require("../../src/services/platform/migrator");

/** One real file, so hashFile()/path.relative() run against genuine bytes. */
const ONE_FILE = [path.join(m.MIGRATIONS, "tenant", "0120_events_workflow.sql")];

function fakeClient() {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      sql.push({ text, params });
      if (/SELECT filename FROM public\.schema_migration/.test(text)) {
        return { rows: [] }; // nothing applied yet
      }
      return { rows: [] };
    },
  };
}

const tx = (list, re) => list.filter((s) => re.test(s.text));

describe("applyTracked transaction boundaries", () => {
  test("default wraps each file in its own BEGIN/COMMIT", async () => {
    const cli = fakeClient();
    await m.applyTracked(cli, ONE_FILE, { scope: "live", searchPath: "live,public" });

    expect(tx(cli.sql, /^\s*BEGIN/i)).toHaveLength(1);
    expect(tx(cli.sql, /^\s*COMMIT/i)).toHaveLength(1);
    // The file's DDL runs between BEGIN and COMMIT.
    const beginAt = cli.sql.findIndex((s) => /^\s*BEGIN/i.test(s.text));
    const ddlAt = cli.sql.findIndex((s) => /SET search_path = live,public/.test(s.text));
    const commitAt = cli.sql.findIndex((s) => /^\s*COMMIT/i.test(s.text));
    expect(beginAt).toBeLessThan(ddlAt);
    expect(ddlAt).toBeLessThan(commitAt);
  });

  test("wrapTransaction:false emits NO BEGIN/COMMIT — the caller owns the transaction", async () => {
    const cli = fakeClient();
    await m.applyTracked(cli, ONE_FILE, {
      scope: "sandbox",
      searchPath: "sandbox,public",
      wrapTransaction: false,
    });

    expect(tx(cli.sql, /^\s*BEGIN/i)).toHaveLength(0);
    expect(tx(cli.sql, /^\s*COMMIT/i)).toHaveLength(0);
    expect(tx(cli.sql, /^\s*ROLLBACK/i)).toHaveLength(0);
    // The file still runs and is still recorded in the ledger.
    expect(tx(cli.sql, /SET search_path = sandbox,public/)).toHaveLength(1);
    expect(
      tx(cli.sql, /INSERT INTO public\.schema_migration/),
    ).toHaveLength(1);
  });

  test("wrapTransaction:false leaves ROLLBACK to the caller on failure", async () => {
    const cli = fakeClient();
    // First query after the ledger probe throws — simulating a migration file
    // whose DDL fails. applyTracked must NOT roll back; the caller will.
    let first = true;
    cli.query = async (text, params) => {
      cli.sql.push({ text, params });
      if (/SELECT filename FROM public\.schema_migration/.test(text)) {
        return { rows: [] };
      }
      if (/SET search_path/.test(text)) {
        if (first) {
          first = false;
          throw new Error("relation \"other_table\" does not exist");
        }
      }
      return { rows: [] };
    };

    await expect(
      m.applyTracked(cli, ONE_FILE, {
        scope: "sandbox",
        searchPath: "sandbox,public",
        wrapTransaction: false,
      }),
    ).rejects.toThrow(/Failed applying tenant\/0120_events_workflow\.sql/);

    expect(tx(cli.sql, /^\s*ROLLBACK/i)).toHaveLength(0);
  });
});
