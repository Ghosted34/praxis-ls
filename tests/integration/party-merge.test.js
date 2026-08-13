"use strict";
/**
 * DB-backed proof of the governed merge (PR3-C §5.2) against a real provisioned
 * tenant schema. Skipped unless DATABASE_URL points at a migrated + seeded tenant
 * DB (search_path = the tenant schema) — the same gate every integration suite
 * here uses. CI provides it via the postgres service + db:provision.
 *
 * Asserts the five things the brief calls out: FK reattachment, alias
 * preservation, loser archived-not-deleted, aux account deactivated, and open
 * compliance flags re-pointed to the survivor.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("governed merge (real Postgres)", () => {
  let pool;
  let merge;
  let accounting;
  let survivorId;
  let loserId;
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    merge = require("../../src/modules/master/party_merge/party_merge.service");
    accounting = require("../../src/modules/master/party-accounting.service");

    const c = await pool.connect();
    try {
      const s = await c.query(
        "INSERT INTO client_master (name, legal_name, name_norm, ref, registration_status, is_active) VALUES ($1,$1,$2,$3,'ACTIVE',true) RETURNING client_id",
        [`Survivor ${uniq}`, `survivor ${uniq}`, `SURV-${uniq}`],
      );
      survivorId = s.rows[0].client_id;
      const l = await c.query(
        "INSERT INTO client_master (name, legal_name, name_norm, ref, registration_status, is_active) VALUES ($1,$1,$2,$3,'ACTIVE',true) RETURNING client_id",
        [`Loser ${uniq}`, `loser ${uniq}`, `LOSE-${uniq}`],
      );
      loserId = l.rows[0].client_id;

      // The loser owns real FK children + an aux account + an open flag.
      await accounting.allocateAux(c, { kind: "client", partyId: loserId });
      await c.query(
        "INSERT INTO party_registration (client_id, kind, number) VALUES ($1,'NIU',$2)",
        [loserId, `NIU${uniq}`],
      );
      await c.query(
        "INSERT INTO client_contact (client_id, name) VALUES ($1,$2)",
        [loserId, `Contact ${uniq}`],
      );
      await c.query(
        "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ('party.bank_unverified',$1,'ESCALATED','x')",
        [`client:${loserId}`],
      );

      await merge.merge(c, { kind: "client", survivorId, loserId, actor: {} });
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("reattaches the loser's registrations and contacts to the survivor", async () => {
    const regs = await pool.query(
      "SELECT client_id FROM party_registration WHERE number = $1",
      [`NIU${uniq}`],
    );
    expect(regs.rows[0].client_id).toBe(survivorId);
    const contacts = await pool.query(
      "SELECT client_id FROM client_contact WHERE name = $1",
      [`Contact ${uniq}`],
    );
    expect(contacts.rows[0].client_id).toBe(survivorId);
  });

  it("archives the loser (never deletes) and points merged_into_id at the survivor", async () => {
    const { rows } = await pool.query(
      "SELECT registration_status, is_active, merged_into_id, deactivation_reason FROM client_master WHERE client_id = $1",
      [loserId],
    );
    expect(rows).toHaveLength(1); // still there — not deleted
    expect(rows[0].registration_status).toBe("ARCHIVED");
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].merged_into_id).toBe(survivorId);
    expect(rows[0].deactivation_reason).toMatch(/merged into/);
  });

  it("preserves the loser's name as an alias under the survivor", async () => {
    const { rows } = await pool.query(
      "SELECT alias FROM party_alias WHERE party_kind = 'client' AND party_id = $1",
      [survivorId],
    );
    expect(rows.map((r) => r.alias)).toContain(`Loser ${uniq}`);
  });

  it("deactivates the loser's aux account (never deletes it)", async () => {
    const { rows } = await pool.query(
      "SELECT coa_aux_account FROM client_master WHERE client_id = $1",
      [loserId],
    );
    const code = rows[0].coa_aux_account;
    expect(code).toBeTruthy();
    const acct = await pool.query(
      "SELECT is_active FROM chart_of_accounts WHERE code = $1",
      [code],
    );
    expect(acct.rows[0].is_active).toBe(false);
  });

  it("re-points the loser's open compliance flags to the survivor", async () => {
    const onLoser = await pool.query(
      "SELECT count(*)::int AS n FROM compliance_flag WHERE entity_ref = $1 AND resolved_at IS NULL",
      [`client:${loserId}`],
    );
    const onSurvivor = await pool.query(
      "SELECT count(*)::int AS n FROM compliance_flag WHERE entity_ref = $1 AND resolved_at IS NULL AND message = 'x'",
      [`client:${survivorId}`],
    );
    expect(onLoser.rows[0].n).toBe(0);
    expect(onSurvivor.rows[0].n).toBeGreaterThanOrEqual(1);
  });
});
