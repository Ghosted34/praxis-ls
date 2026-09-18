"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const migration = fs.readFileSync(
  path.join(__dirname, "../../migrations/tenant/13890_workspace_reminder_many.sql"),
  "utf8",
);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// Run the real migration in a disposable schema, never against tenant tables.
describeDb("13890 legacy reminder backfill (Postgres)", () => {
  let client;

  beforeAll(async () => {
    const { Client } = require("pg");
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  test("normalizes legacy pairs without dropping armed reminders", async () => {
    await client.query("BEGIN");
    try {
      const schema = `reminder_test_${randomUUID().replace(/-/g, "")}`;
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path = ${schema}, public`);
      await client.query(`
        CREATE TABLE task (
          task_id uuid PRIMARY KEY,
          reminder_minutes integer, remind_at timestamptz,
          reminder_sent_at timestamptz, is_deleted boolean DEFAULT false,
          created_by uuid, created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        );
        CREATE TABLE calendar_event (LIKE task INCLUDING ALL);
        ALTER TABLE calendar_event RENAME COLUMN task_id TO calendar_event_id;
        CREATE TABLE event_type (
          key text PRIMARY KEY, module_key text, name text,
          is_security_critical boolean, is_approvable boolean
        );
      `);
      const instant = "2026-09-18T15:00:00.000Z";
      const fixtures = [
        { minutes: 30, at: instant, scope: "series" }, // legacy resolved pair
        { minutes: 0, at: instant, scope: "series" }, // zero is relative too
        { minutes: 60, at: null, scope: "series" },
        { minutes: null, at: instant, scope: "this" },
        { minutes: 15, at: instant, scope: "series", deleted: true },
        { minutes: 30, at: instant, sent: instant, skip: true },
        { minutes: null, at: null, skip: true },
      ];
      const expected = [];
      for (const [table, idColumn] of [
        ["task", "task_id"],
        ["calendar_event", "calendar_event_id"],
      ]) {
        for (const fixture of fixtures) {
          const id = randomUUID();
          await client.query(
            `INSERT INTO ${table}
              (${idColumn}, reminder_minutes, remind_at, reminder_sent_at, is_deleted)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, fixture.minutes, fixture.at, fixture.sent || null, !!fixture.deleted],
          );
          if (!fixture.skip) {
            expected.push({
              owner_type: table, owner_id: id,
              reminder_minutes: fixture.minutes,
              remind_at: fixture.minutes === null ? new Date(instant) : null,
              reminder_sent_at: null, ordinal: 1, scope: fixture.scope,
              email: false, is_deleted: !!fixture.deleted,
            });
          }
        }
      }

      await client.query(migration);
      const { rows } = await client.query(`
        SELECT owner_type, owner_id, reminder_minutes, remind_at,
               reminder_sent_at, ordinal, scope, email, is_deleted
        FROM workspace_reminder
      `);
      expect(rows).toHaveLength(expected.length);
      expect(rows).toEqual(expect.arrayContaining(expected));
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
