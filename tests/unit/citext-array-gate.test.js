"use strict";

/**
 * FN-1 — the gate that stands where four test layers had a hole.
 *
 * `citext` is an extension type, so its array form has no fixed OID and
 * node-postgres ships no parser for it: an uncast read hands JavaScript the raw
 * literal `"{a@b.cm,c@d.cm}"` as a STRING. That took out the Mailbox tab, and it
 * had already taken out feature entitlement once before in
 * `provisioning.service.js`. `scripts/check-citext-arrays.js` is what makes the
 * third occurrence a red build instead of a support ticket.
 *
 * What is worth testing here is the gate's JUDGEMENT, not that it can read a
 * directory. Two ways for it to be useless, and both have actually happened
 * during its own development:
 *
 *   · a blind spot — it silently skipped `CREATE TABLE platform.x`, so every
 *     platform table was invisible to it and it reported green over them;
 *   · noise — an early draft flagged INSERT column lists and JS parameter
 *     arrays, and a gate that cries wolf gets switched off.
 *
 * So: the discovery cases pin what it must SEE, and the quiet cases pin what it
 * must NOT shout about.
 */

const {
  columnsInSql,
  projections,
  scanSource,
} = require("../../scripts/check-citext-arrays");

/** `{ table => Set(column) }`, the shape the scanner wants. */
const byTable = (spec) =>
  new Map(Object.entries(spec).map(([t, cols]) => [t, new Set(cols)]));

const MAIL = byTable({ email_thread: ["participants"] });
const flags = (source, tables = MAIL) => scanSource(source, "t.js", tables);

describe("citext[] column discovery", () => {
  it("finds a plain CREATE TABLE column", () => {
    expect(columnsInSql(`
      CREATE TABLE email_thread (
        email_thread_id uuid PRIMARY KEY,
        participants    citext[] NOT NULL DEFAULT '{}'
      );
    `)).toEqual([["email_thread", "participants"]]);
  });

  it("finds a SCHEMA-QUALIFIED one — the blind spot that hid every platform table", () => {
    expect(columnsInSql(`
      CREATE TABLE platform.feature_catalogue (
        feature_key citext UNIQUE NOT NULL,
        depends_on  citext[] NOT NULL DEFAULT '{}'
      );
    `)).toEqual([["feature_catalogue", "depends_on"]]);
  });

  it("finds one added by ALTER TABLE, qualified or not", () => {
    expect(columnsInSql(
      "ALTER TABLE live.email_draft ADD COLUMN IF NOT EXISTS bcc_address citext[];"
    )).toEqual([["email_draft", "bcc_address"]]);
  });

  it("does not mistake a SCALAR citext for an array", () => {
    expect(columnsInSql(`
      CREATE TABLE email_send_log (
        to_address citext NOT NULL
      );
    `)).toEqual([]);
  });
});

describe("what the gate flags", () => {
  it("flags a bare read", () => {
    const hits = flags("db.query(`SELECT participants FROM email_thread`)");
    expect(hits.map((h) => h.what)).toEqual(["participants"]);
  });

  it("flags a qualified read", () => {
    expect(flags("db.query(`SELECT t.participants FROM email_thread t`)")).toHaveLength(1);
  });

  it("flags RETURNING *, which drags the raw column along — the silent ingest bug", () => {
    const hits = flags(
      "db.query(`INSERT INTO email_thread (thread_key) VALUES ($1) RETURNING *`)"
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].what).toMatch(/carries participants/);
  });

  it("accepts the cast appended after a star", () => {
    expect(flags(
      "db.query(`INSERT INTO email_thread (thread_key) VALUES ($1)" +
      " RETURNING *, participants::text[] AS participants`)"
    )).toEqual([]);
  });

  it("accepts an explicit cast", () => {
    expect(flags(
      "db.query(`SELECT t.participants::text[] AS participants FROM email_thread t`)"
    )).toEqual([]);
  });

  it("accepts array_to_string, which returns text and is therefore safe", () => {
    expect(flags(
      "db.query(`SELECT array_to_string(t.participants, ',') AS p FROM email_thread t`)"
    )).toEqual([]);
  });
});

describe("what the gate stays quiet about", () => {
  it("an INSERT column list — pg coerces a JS array on the way IN", () => {
    expect(flags(
      "db.query(`INSERT INTO email_thread (thread_key, participants) VALUES ($1, $2)`)"
    )).toEqual([]);
  });

  it("a WHERE clause — it is not a projection, nothing flows back", () => {
    expect(flags(
      "db.query(`SELECT thread_key FROM email_thread WHERE participants && $1`)"
    )).toEqual([]);
  });

  it("a JavaScript parameter array that merely names the column", () => {
    expect(flags(
      "db.query(sql, [row.participants, row.subject]);"
    )).toEqual([]);
  });

  it("a star on a table that has no citext[] column of its own", () => {
    const tables = byTable({ email_thread: ["participants"] });
    expect(flags("db.query(`SELECT f.* FROM email_folder f`)", tables)).toEqual([]);
  });

  it("a statement against an unrelated table", () => {
    expect(flags("db.query(`SELECT participants FROM meeting_invite`)")).toEqual([]);
  });
});

describe("projection isolation", () => {
  it("keeps the SELECT list and the RETURNING clause, and nothing else", () => {
    const parts = projections(
      "SELECT a, b FROM x WHERE c = 1 RETURNING d"
    ).map((s) => s.trim());
    expect(parts).toEqual(["a, b", "d"]);
  });
});
