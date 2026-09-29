"use strict";

/**
 * 14250 — real people in TEST, and nothing from TEST in LIVE, against a real
 * Postgres.
 *
 * Owner decision, 29 Sep 2026: "the sandbox shows real employees, but the live
 * never shows sandbox". A trigger on `live.employee` / `live.corporate_entity`
 * copies every live write into the sandbox; the same trigger on the sandbox
 * tables does nothing. The properties below are all database facts — a trigger,
 * a unique index, a foreign key — so a fake client cannot say anything about
 * them, which is why this suite exists beside the unit tests.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant (CI sets it after
 * `provision-tenant`); self-skips otherwise, like every suite in this directory.
 * Every query names its schema, so the connection's search_path does not matter.
 */

const crypto = require("crypto");
const { Pool } = require("pg");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let pool;
const tag = crypto.randomBytes(3).toString("hex").toUpperCase();
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

/** A live company, cleaned up at the end. Codes are unique, so each is tagged. */
async function liveCompany(suffix) {
  return one(
    "INSERT INTO live.corporate_entity (code, legal_name, country_code) VALUES ($1, $2, 'CM') RETURNING entity_id, code",
    [`M${tag}${suffix}`, `Mirror ${tag} ${suffix}`],
  );
}

d("the sandbox follows live people, one way (14250)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    if (!pool) return;
    // Live deletes remove the copies through the trigger; sandbox-only rows and
    // accounts are removed directly.
    await q("DELETE FROM sandbox.app_user WHERE email LIKE $1", [`%${tag.toLowerCase()}@mirror.test`]);
    await q("DELETE FROM live.app_user WHERE email LIKE $1", [`%${tag.toLowerCase()}@mirror.test`]);
    await q("DELETE FROM live.employee WHERE full_name LIKE $1", [`%${tag}%`]);
    await q("DELETE FROM sandbox.employee WHERE full_name LIKE $1", [`%${tag}%`]);
    await q("DELETE FROM live.corporate_entity WHERE code LIKE $1", [`M${tag}%`]);
    await q("DELETE FROM sandbox.corporate_entity WHERE code LIKE $1", [`M${tag}%`]);
    await pool.end();
  });

  test("a live hire appears in the sandbox under the same id, with its company, marked as a copy", async () => {
    const co = await liveCompany("A");
    const emp = await one(
      `INSERT INTO live.employee (full_name, entity_id, status, base_salary, work_days)
       VALUES ($1, $2, 'ACTIVE', 250000, '{1,2,3,4,5}') RETURNING employee_id`,
      [`Real ${tag} A`, co.entity_id],
    );
    const copy = await one(
      `SELECT e.full_name, e.base_salary::text AS base_salary, e.work_days, e.is_active,
              e.copied_from_live_at, c.code
         FROM sandbox.employee e JOIN sandbox.corporate_entity c USING (entity_id)
        WHERE e.employee_id = $1`,
      [emp.employee_id],
    );
    expect(copy).toMatchObject({
      full_name: `Real ${tag} A`, base_salary: "250000.00", work_days: [1, 2, 3, 4, 5], is_active: true, code: co.code,
    });
    expect(copy.copied_from_live_at).toBeInstanceOf(Date);

    // Live never carries the marker.
    const live = await one("SELECT copied_from_live_at FROM live.employee WHERE employee_id = $1", [emp.employee_id]);
    expect(live.copied_from_live_at).toBeNull();
  });

  test("a person created in TEST never reaches live — not on create, not on edit", async () => {
    const t = await one(
      "INSERT INTO sandbox.employee (full_name) VALUES ($1) RETURNING employee_id",
      [`Test ${tag} only`],
    );
    await q("UPDATE sandbox.employee SET job_title = 'Tester' WHERE employee_id = $1", [t.employee_id]);
    const inLive = await one("SELECT count(*)::int AS n FROM live.employee WHERE employee_id = $1 OR full_name = $2", [
      t.employee_id, `Test ${tag} only`,
    ]);
    expect(inLive.n).toBe(0);
  });

  test("live wins: a TEST edit stands until the next live change, which replaces it", async () => {
    const emp = await one("INSERT INTO live.employee (full_name) VALUES ($1) RETURNING employee_id", [`Real ${tag} B`]);
    await q("UPDATE sandbox.employee SET full_name = $2 WHERE employee_id = $1", [emp.employee_id, `Edited ${tag} in TEST`]);

    // A deploy's backfill fills gaps only — the TEST edit survives it.
    await q("SELECT * FROM live.sandbox_backfill_from_live()");
    expect((await one("SELECT full_name FROM sandbox.employee WHERE employee_id = $1", [emp.employee_id])).full_name)
      .toBe(`Edited ${tag} in TEST`);

    // A live change does not.
    await q("UPDATE live.employee SET job_title = 'Driver' WHERE employee_id = $1", [emp.employee_id]);
    expect(await one("SELECT full_name, job_title FROM sandbox.employee WHERE employee_id = $1", [emp.employee_id]))
      .toEqual({ full_name: `Real ${tag} B`, job_title: "Driver" });
  });

  test("the backfill brings across live people the sandbox is missing, managers included", async () => {
    const boss = await one("INSERT INTO live.employee (full_name) VALUES ($1) RETURNING employee_id", [`Boss ${tag}`]);
    const rep = await one(
      "INSERT INTO live.employee (full_name, reports_to) VALUES ($1, $2) RETURNING employee_id",
      [`Report ${tag}`, boss.employee_id],
    );
    // As after a sandbox wipe: the copies are gone.
    await q("DELETE FROM sandbox.employee WHERE employee_id = ANY($1)", [[rep.employee_id, boss.employee_id]]);

    await q("SELECT * FROM live.sandbox_backfill_from_live()");
    const copy = await one("SELECT reports_to, copied_from_live_at FROM sandbox.employee WHERE employee_id = $1", [rep.employee_id]);
    expect(copy.reports_to).toBe(boss.employee_id);
    expect(copy.copied_from_live_at).toBeInstanceOf(Date);
  });

  test("a TEST person holding a real matricule gives it up, keeping it with -T", async () => {
    const staffNo = `M${tag}-001`;
    const t = await one(
      "INSERT INTO sandbox.employee (full_name, staff_no) VALUES ($1, $2) RETURNING employee_id",
      [`Test ${tag} clash`, staffNo],
    );
    const real = await one(
      "INSERT INTO live.employee (full_name, staff_no) VALUES ($1, $2) RETURNING employee_id",
      [`Real ${tag} clash`, staffNo],
    );
    expect((await one("SELECT employee_id FROM sandbox.employee WHERE staff_no = $1", [staffNo])).employee_id)
      .toBe(real.employee_id);
    expect((await one("SELECT staff_no FROM sandbox.employee WHERE employee_id = $1", [t.employee_id])).staff_no)
      .toBe(`${staffNo}-T`);
  });

  test("a sandbox problem never fails the live write", async () => {
    // A row the copier may not renumber (it claims to be a copy of someone else)
    // holds the matricule. The copy is refused by the unique index — and the
    // live hire commits anyway, with a WARNING instead of an error.
    const staffNo = `M${tag}-002`;
    await q(
      "INSERT INTO sandbox.employee (full_name, staff_no, copied_from_live_at) VALUES ($1, $2, now())",
      [`Stale ${tag} copy`, staffNo],
    );
    const real = await one(
      "INSERT INTO live.employee (full_name, staff_no) VALUES ($1, $2) RETURNING employee_id",
      [`Real ${tag} blocked`, staffNo],
    );
    expect((await one("SELECT count(*)::int AS n FROM live.employee WHERE employee_id = $1", [real.employee_id])).n).toBe(1);
    expect((await one("SELECT count(*)::int AS n FROM sandbox.employee WHERE employee_id = $1", [real.employee_id])).n).toBe(0);
  });

  test("a company link the sandbox cannot satisfy is cleared, not fatal", async () => {
    const co = await liveCompany("B");
    const acct = await one(
      `INSERT INTO live.treasury_account (entity_id, kind, label, coa_code)
       VALUES ($1, 'BANK', $2, '521') RETURNING treasury_account_id`,
      [co.entity_id, `Mirror ${tag}`],
    );
    await q("UPDATE live.corporate_entity SET remittance_account_id = $2 WHERE entity_id = $1", [
      co.entity_id, acct.treasury_account_id,
    ]);
    const copy = await one("SELECT remittance_account_id FROM sandbox.corporate_entity WHERE entity_id = $1", [co.entity_id]);
    expect(copy).toBeDefined();
    expect(copy.remittance_account_id).toBeNull();
    await q("UPDATE live.corporate_entity SET remittance_account_id = NULL WHERE entity_id = $1", [co.entity_id]);
    await q("DELETE FROM live.treasury_account WHERE treasury_account_id = $1", [acct.treasury_account_id]);
  });

  test("the account provisioned for a live employee is linked to them in TEST too", async () => {
    const emp = await one("INSERT INTO live.employee (full_name) VALUES ($1) RETURNING employee_id", [`Real ${tag} account`]);
    const email = `acct-${tag.toLowerCase()}@mirror.test`;
    const user = await one(
      `INSERT INTO live.app_user (username, email, full_name, password_hash, status, employee_id)
       VALUES ($1, $1, $2, 'x', 'ACTIVE', $3) RETURNING user_id`,
      [email, `Real ${tag} account`, emp.employee_id],
    );
    const { mirrorUsersIntoSandbox } = require("../../src/shared/db/sandbox-user-mirror");
    const client = await pool.connect();
    try {
      await mirrorUsersIntoSandbox(client, { userId: user.user_id });
    } finally {
      client.release();
    }
    expect((await one("SELECT employee_id FROM sandbox.app_user WHERE user_id = $1", [user.user_id])).employee_id)
      .toBe(emp.employee_id);
  });

  test("a live delete removes an unreferenced copy", async () => {
    const emp = await one("INSERT INTO live.employee (full_name) VALUES ($1) RETURNING employee_id", [`Real ${tag} gone`]);
    await q("DELETE FROM live.employee WHERE employee_id = $1", [emp.employee_id]);
    expect((await one("SELECT count(*)::int AS n FROM sandbox.employee WHERE employee_id = $1", [emp.employee_id])).n).toBe(0);
  });
});
