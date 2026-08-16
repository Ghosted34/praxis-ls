"use strict";
/**
 * Lead 360 and Intake 360 against a real Postgres.
 *
 * The unit suite mocks the client and proves the JUDGEMENT — what is gated,
 * what is counted, what a brand-new record renders as. It cannot prove the
 * queries, and the queries are the part that breaks silently: every one of them
 * names columns across seven tables (`lead`, `meeting`,
 * `meeting_discovery_section`, `quote_request`, `proposal`, `proposal_line`,
 * `opportunity`, `contact_enquiry`, `immutable_ledger`), and a column renamed
 * in a later migration surfaces as a 500 nobody's mocked test can see.
 *
 * So this runs each dossier against a live schema. It asserts shape, not
 * content — the tenant it points at may have any amount of data in it, or none
 * — which is exactly the assertion that would have caught a bad column name.
 *
 * Skipped unless DATABASE_URL is set, per the convention in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Sales 360 aggregations (real Postgres)", () => {
  let pool, client, svc;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("SET search_path = live, public");
    svc = require("../../src/modules/sales/sales-360.service");
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  /** A lead to hang the assertions on. Created here so the test owns its data. */
  async function makeLead() {
    const { rows } = await client.query(
      `INSERT INTO lead (company_name, contact_name, email, status, country, niu, rccm)
       VALUES ('360 Integration Co', 'Test Contact', 'i360@example.test', 'NEW', 'CM', 'NIU-360', 'RCCM-360')
       RETURNING lead_id`,
    );
    return rows[0].lead_id;
  }

  test("every query in the lead dossier executes against the real schema", async () => {
    const leadId = await makeLead();
    const dossier = await svc.leadDossier(client, { leadId, canSeeFinancials: true });

    expect(dossier.lead.lead_id).toBe(leadId);
    for (const k of ["meetings", "quote_requests", "proposals", "opportunities", "enquiries", "timeline"]) {
      expect(Array.isArray(dossier[k])).toBe(true);
    }
    // A lead created a second ago has nothing hanging off it, which is the
    // "renders for a brand-new record" gate — proven here against real SQL
    // rather than against a mock that returns whatever it was told to.
    expect(dossier.kpis.meetings).toBe(0);
    expect(dossier.kpis.open_pipeline_value).toBe(0);
    expect(dossier.client).toBeNull();
  });

  test("related records show up in the right collections", async () => {
    const leadId = await makeLead();

    const meeting = (
      await client.query(
        `INSERT INTO meeting (subject, lead_id, location) VALUES ('Discovery', $1, 'Douala')
         RETURNING meeting_id`,
        [leadId],
      )
    ).rows[0].meeting_id;
    await client.query(
      `INSERT INTO meeting_discovery_section (meeting_id, section_key, body)
       VALUES ($1, 'OPERATIONS', 'Reefer imports, 30 TEU a month.')`,
      [meeting],
    );
    const proposal = (
      await client.query(
        `INSERT INTO proposal (lead_id, title, status, currency) VALUES ($1, '360 proposal', 'DRAFT', 'XAF')
         RETURNING proposal_id`,
        [leadId],
      )
    ).rows[0].proposal_id;
    await client.query(
      `INSERT INTO proposal_line (proposal_id, label, qty, unit_price) VALUES ($1, 'Freight', 2, 750000)`,
      [proposal],
    );

    const dossier = await svc.leadDossier(client, { leadId, canSeeFinancials: true });

    expect(dossier.meetings).toHaveLength(1);
    expect(dossier.meetings[0].sections.map((s) => s.section_key)).toEqual(["OPERATIONS"]);
    expect(dossier.meetings[0].sections[0].has_body).toBe(true);
    expect(dossier.kpis.discovery_sections_captured).toBe(1);

    expect(dossier.proposals).toHaveLength(1);
    // 2 × 750,000 — summed in SQL, which is the arithmetic a mock cannot check.
    expect(dossier.proposals[0].total).toBe(1500000);
    expect(dossier.kpis.proposals_value).toBe(1500000);
  });

  test("the same dossier hides money from a caller without finance visibility", async () => {
    const leadId = await makeLead();
    const proposal = (
      await client.query(
        `INSERT INTO proposal (lead_id, title, status, currency) VALUES ($1, 'Gated', 'DRAFT', 'XAF')
         RETURNING proposal_id`,
        [leadId],
      )
    ).rows[0].proposal_id;
    await client.query(
      `INSERT INTO proposal_line (proposal_id, label, qty, unit_price) VALUES ($1, 'Freight', 1, 999)`,
      [proposal],
    );

    const hidden = await svc.leadDossier(client, { leadId, canSeeFinancials: false });
    expect(hidden.kpis.money_visible).toBe(false);
    expect(hidden.kpis.proposals_value).toBeNull();
    expect(hidden.proposals[0].total).toBeNull();
    // The row itself is still there and still readable — only the figure is not.
    expect(hidden.kpis.proposals).toBe(1);
    expect(hidden.proposals[0].title).toBe("Gated");
  });

  test("the timeline reads the audit rows the lead's own service writes", async () => {
    const leadId = await makeLead();
    await client.query(
      `INSERT INTO immutable_ledger (action, module_key, entity_ref) VALUES ('lead.created', 'MOD-20', $1)`,
      ["lead:" + leadId],
    );
    const dossier = await svc.leadDossier(client, { leadId });
    expect(dossier.timeline.map((t) => t.action)).toContain("lead.created");
    expect(dossier.timeline[0].occurred_at).toBeTruthy();
  });

  test("every query in the intake dossier executes against the real schema", async () => {
    const entity = (await client.query("SELECT entity_id FROM corporate_entity LIMIT 1")).rows[0];
    const q = (
      await client.query(
        `INSERT INTO quote_request (incoterm, requester_name, status, entity_id)
         VALUES ('FOB', '360 Integration', 'RECEIVED', $1) RETURNING quote_request_id`,
        [entity ? entity.entity_id : null],
      )
    ).rows[0].quote_request_id;

    const dossier = await svc.intakeDossier(client, { quoteRequestId: q, canSeeFinancials: true });
    expect(dossier.request.quote_request_id).toBe(q);
    expect(Array.isArray(dossier.attachments)).toBe(true);
    expect(Array.isArray(dossier.timeline)).toBe(true);
    expect(dossier.kpis.is_converted).toBe(false);
    expect(dossier.converted_opportunity).toBeNull();
    expect(dossier.lead).toBeNull();
    expect(dossier.kpis.age_days).toBe(0);
  });

  test("an unknown id is a 404 on both dossiers", async () => {
    const ghost = "11111111-1111-1111-1111-111111111111";
    await expect(svc.leadDossier(client, { leadId: ghost })).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.intakeDossier(client, { quoteRequestId: ghost }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
