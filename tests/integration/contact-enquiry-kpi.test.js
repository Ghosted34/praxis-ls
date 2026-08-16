"use strict";
/**
 * F9 KPI partition proof, against a real Postgres.
 *
 * THE INVARIANT: every contact_enquiry row lands in exactly one tile, and the
 * tiles sum to the visible TOTAL under any non-status filter.
 *
 * The unit test proves the fold. This one proves the SQL underneath it, which
 * is where the legacy's two defects actually live:
 *
 *   1. The tiles come from a GROUP BY over the whole filtered set, not from
 *      looping the page. The legacy counts in PHP over the rows it just fetched
 *      under LIMIT 200, so a desk with 300 messages reports "Total: 200" — a
 *      number wrong in the direction that looks plausible. The pagination test
 *      below is the one that catches a regression to that.
 *
 *   2. The KPI query drops the STATUS filter and keeps every other one, so
 *      filtering to RESPONDED still shows the whole summary rather than one
 *      tile equal to the total and the rest at zero.
 *
 * Skipped unless DATABASE_URL is set (the convention the other tests in
 * tests/integration/ use).
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("F9 contact_enquiry KPI partition (real Postgres)", () => {
  let pool, service, rules;
  const marker = "F9KPI-" + process.pid + "-" + Math.floor(Math.random() * 1e6);

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    service = require("../../src/modules/sales/inbound_intake/inbound_intake.service");
    rules = require("../../src/modules/sales/inbound_intake/inbound_intake.rules");

    // The migrator keys on the relative path; the CI step that calls this test
    // runs the standard tenant set first, so 0689 should already be in the
    // ledger. Assert the shape it added before going further — a missing column
    // here would otherwise surface as a confusing SQL error mid-assertion.
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'contact_enquiry'
          AND column_name IN ('enquiry_type','company_name','internal_notes','responded_at','partnership_request_id')`,
    );
    if (rows.length < 5) {
      throw new Error(
        "contact_enquiry is missing F9 columns — apply migrations/tenant/0689_sales_crm_f9_contact_enquiries.sql first.",
      );
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.query("DELETE FROM contact_enquiry WHERE subject LIKE $1", [marker + "%"]);
      await pool.end();
    }
  });

  /** Sum every status tile plus OTHER — what assertPartitions checks, restated. */
  const sumTiles = (kpi) =>
    rules.STATUSES.reduce((n, s) => n + (kpi[s] || 0), 0) + (kpi.OTHER || 0);

  const seed = (rows) =>
    Promise.all(rows.map((r, i) =>
      pool.query(
        `INSERT INTO contact_enquiry (name, email, subject, message, status, enquiry_type, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "Test " + i, `f9-${i}@example.com`, `${marker} ${r.status} ${i}`,
          "body", r.status, r.type, "WEBSITE",
        ],
      )));

  test("the tiles partition the result set under every filter", async () => {
    // 2 NEW, 2 READ, 1 RESPONDED, 1 CLOSED = 6 rows, across three types.
    await seed([
      { status: "NEW", type: "GENERAL_ENQUIRY" },
      { status: "NEW", type: "PARTNERSHIP" },
      { status: "READ", type: "GENERAL_ENQUIRY" },
      { status: "READ", type: "CAREERS" },
      { status: "RESPONDED", type: "GENERAL_ENQUIRY" },
      { status: "CLOSED", type: "MEDIA" },
    ]);

    // 1. Scoped to this test's rows via the search filter, so a shared database
    //    with other enquiries in it does not make the assertion meaningless.
    const all = await pool.connect().then(async (c) => {
      try { return await service.listEnquiries(c, { q: marker, limit: 200 }); }
      finally { c.release(); }
    });
    expect(all.kpi.TOTAL).toBe(6);
    expect(all.kpi.NEW).toBe(2);
    expect(all.kpi.READ).toBe(2);
    expect(all.kpi.RESPONDED).toBe(1);
    expect(all.kpi.CLOSED).toBe(1);
    // The READ rows are the ones the legacy loses: counted in Total, shown in
    // no tile. Here they are in a tile, and the tiles balance.
    expect(sumTiles(all.kpi)).toBe(all.kpi.TOTAL);

    // 2. Filtered by TYPE — a non-status filter, so it narrows both the rows
    //    and the summary, and the summary still balances.
    const general = await pool.connect().then(async (c) => {
      try { return await service.listEnquiries(c, { q: marker, enquiry_type: "GENERAL_ENQUIRY" }); }
      finally { c.release(); }
    });
    expect(general.kpi.TOTAL).toBe(3);
    expect(sumTiles(general.kpi)).toBe(general.kpi.TOTAL);

    // 3. Filtered by STATUS — the summary must NOT collapse to one tile. This
    //    is the assertion that keeps the status filter out of the KPI query.
    const responded = await pool.connect().then(async (c) => {
      try { return await service.listEnquiries(c, { q: marker, status: "RESPONDED" }); }
      finally { c.release(); }
    });
    expect(responded.rows).toHaveLength(1);
    expect(responded.total).toBe(1);
    expect(responded.kpi.TOTAL).toBe(6);          // the whole filtered set
    expect(responded.kpi.NEW).toBe(2);            // not zeroed by the filter
    expect(sumTiles(responded.kpi)).toBe(responded.kpi.TOTAL);
  });

  test("the tiles count the whole set, not the page — the legacy's LIMIT bug", async () => {
    const c = await pool.connect();
    try {
      const paged = await service.listEnquiries(c, { q: marker, limit: 2 });
      expect(paged.rows).toHaveLength(2);   // the page is short
      expect(paged.total).toBe(6);          // the count is not
      expect(paged.kpi.TOTAL).toBe(6);      // and neither are the tiles
      expect(sumTiles(paged.kpi)).toBe(paged.kpi.TOTAL);
    } finally { c.release(); }
  });

  test("the type filter actually filters", async () => {
    const c = await pool.connect();
    try {
      const careers = await service.listEnquiries(c, { q: marker, enquiry_type: "CAREERS" });
      expect(careers.rows).toHaveLength(1);
      expect(String(careers.rows[0].enquiry_type)).toBe("CAREERS");
    } finally { c.release(); }
  });

  test("the database refuses a status outside the correspondence lifecycle", async () => {
    // 0689 replaced the 0350 CHECK. TRIAGED must no longer be writable, or the
    // column is back to carrying two concerns and the tiles can silently
    // acquire an OTHER bucket in production.
    await expect(
      pool.query(
        "INSERT INTO contact_enquiry (subject, status) VALUES ($1, 'TRIAGED')",
        [marker + " illegal"],
      ),
    ).rejects.toThrow();
  });

  test("internal_notes is capped in the database, not only in the validator", async () => {
    await expect(
      pool.query(
        "INSERT INTO contact_enquiry (subject, internal_notes) VALUES ($1, $2)",
        [marker + " long notes", "x".repeat(5001)],
      ),
    ).rejects.toThrow();
  });
});
