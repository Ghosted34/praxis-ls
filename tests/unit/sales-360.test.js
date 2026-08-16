"use strict";

/**
 * Lead 360 and Intake 360 — the aggregation's rules, without a database.
 *
 * The queries themselves are proven against real SQL in
 * tests/integration/sales-360.test.js. What is worth asserting here is the
 * judgement the service applies on top of them, because that is where a
 * dossier misleads someone rather than merely failing:
 *
 *   1. Money that the caller may not see comes back NULL, not 0. A tile reading
 *      "XAF 0" to someone who simply lacks finance visibility is a wrong
 *      answer; "—" is a true one. Counts are never gated.
 *   2. A brand-new record renders. Every figure 0, every collection [] — the
 *      same acceptance gate party-360 is built to (a fresh party must not throw
 *      or read as broken).
 *   3. "Is it converted" is read from `converted_opportunity_id`, never from
 *      the status value. The legacy computed it two ways and got two answers on
 *      one row: the list greyed it out while the drawer still offered Convert.
 *
 * The client is mocked by matching on SQL text rather than by call order, so
 * adding a query to the service does not silently shift every later assertion
 * onto the wrong mock.
 */

const svc = require("../../src/modules/sales/sales-360.service");

/**
 * A pg client whose `query` answers by the first pattern that matches the SQL.
 * Unmatched queries return no rows, which is what an empty record looks like.
 */
function clientOf(routes = []) {
  const calls = [];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      for (const [pattern, rows] of routes) {
        if (pattern.test(String(sql))) return { rows: typeof rows === "function" ? rows(params) : rows };
      }
      return { rows: [] };
    }),
  };
}

const LEAD_ROW = { lead_id: "L1", company_name: "Tema Shipping", status: "QUALIFIED" };

describe("money gating", () => {
  test("money() hides a figure as null rather than zero", () => {
    expect(svc.money(500, true)).toBe(500);
    expect(svc.money(500, false)).toBeNull();
    // A real zero survives when the caller may see it — the point is that the
    // two cases stay distinguishable in both directions.
    expect(svc.money(0, true)).toBe(0);
    expect(svc.money(null, true)).toBe(0);
  });

  test("proposal totals are null for a caller without finance visibility", async () => {
    const rows = [{ proposal_id: "P1", status: "SENT", total: "4000000", currency: "XAF" }];
    const c = clientOf([[/FROM proposal p/, rows]]);
    expect((await svc.leadProposals(c, "L1", true))[0].total).toBe(4000000);
    expect((await svc.leadProposals(c, "L1", false))[0].total).toBeNull();
  });

  test("opportunity value and its weighting are gated together", async () => {
    const rows = [
      { opportunity_id: "O1", status: "OPEN", estimated_value: "8000000", probability: "10.00" },
    ];
    const c = clientOf([[/FROM opportunity o/, rows]]);

    const [visible] = await svc.leadOpportunities(c, "L1", true);
    expect(visible.estimated_value).toBe(8000000);
    expect(visible.weighted_value).toBe(800000);
    // pg hands back numerics as strings; the board coerces, so this must too or
    // the client ends up with two formatters for one field.
    expect(visible.probability).toBe(10);

    const [hidden] = await svc.leadOpportunities(c, "L1", false);
    expect(hidden.estimated_value).toBeNull();
    expect(hidden.weighted_value).toBeNull();
    // The stage and the odds are not money and stay readable.
    expect(hidden.probability).toBe(10);
    expect(hidden.status).toBe("OPEN");
  });
});

describe("lead KPIs", () => {
  const base = {
    meetings: [
      { sections: [{ has_body: true }, { has_body: true }, { has_body: false }] },
      { sections: [{ has_body: true }] },
    ],
    proposals: [
      { status: "SENT", total: 4000000 },
      { status: "ACCEPTED", total: 1000000 },
      { status: "DRAFT", total: 0 },
    ],
    opportunities: [
      { status: "OPEN", estimated_value: 8000000, weighted_value: 800000 },
      { status: "OPEN", estimated_value: 2000000, weighted_value: 600000 },
      { status: "WON", estimated_value: 5000000, weighted_value: 5000000 },
      { status: "LOST", estimated_value: 1000000, weighted_value: 0 },
    ],
    quoteRequests: [{}, {}],
    enquiries: [{}],
  };

  test("counts add up and only captured sections count", () => {
    const k = svc.leadKpis({ ...base, canSee: true });
    expect(k.meetings).toBe(2);
    expect(k.discovery_sections_captured).toBe(3);
    expect(k.quote_requests).toBe(2);
    expect(k.proposals).toBe(3);
    expect(k.proposals_sent).toBe(1);
    expect(k.proposals_accepted).toBe(1);
    expect(k.enquiries).toBe(1);
  });

  test("pipeline value counts OPEN deals only, so it agrees with the board", () => {
    const k = svc.leadKpis({ ...base, canSee: true });
    expect(k.open_opportunities).toBe(2);
    expect(k.won_opportunities).toBe(1);
    expect(k.lost_opportunities).toBe(1);
    // 8,000,000 + 2,000,000 — the won and lost deals are excluded.
    expect(k.open_pipeline_value).toBe(10000000);
    expect(k.weighted_pipeline_value).toBe(1400000);
    expect(k.proposals_value).toBe(5000000);
  });

  test("without finance visibility the counts survive and the money is null", () => {
    const k = svc.leadKpis({ ...base, canSee: false });
    expect(k.money_visible).toBe(false);
    expect(k.open_opportunities).toBe(2);
    expect(k.open_pipeline_value).toBeNull();
    expect(k.weighted_pipeline_value).toBeNull();
    expect(k.proposals_value).toBeNull();
  });

  test("a lead with nothing on it produces zeros, not NaN or undefined", () => {
    const k = svc.leadKpis({
      meetings: [],
      proposals: [],
      opportunities: [],
      quoteRequests: [],
      enquiries: [],
      canSee: true,
    });
    for (const [key, v] of Object.entries(k)) {
      if (key === "money_visible") continue;
      expect(v).toBe(0);
    }
  });
});

describe("leadDossier", () => {
  test("a brand-new lead renders — every collection empty, nothing thrown", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    const d = await svc.leadDossier(c, { leadId: "L1", canSeeFinancials: true });

    expect(d.lead.company_name).toBe("Tema Shipping");
    for (const k of ["meetings", "quote_requests", "proposals", "opportunities", "enquiries", "timeline"]) {
      expect(d[k]).toEqual([]);
    }
    expect(d.client).toBeNull();
    expect(d.kpis.meetings).toBe(0);
    expect(d.kpis.open_pipeline_value).toBe(0);
  });

  test("an unknown lead is a 404, not an empty dossier", async () => {
    const c = clientOf([]);
    await expect(svc.leadDossier(c, { leadId: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  test("the converted client is a card, and only when there is one", async () => {
    const c = clientOf([
      [/FROM lead l/, [{ ...LEAD_ROW, client_id: "C1", client_name: "Tema Shipping SA", public_reference_consent: "NAMED" }]],
    ]);
    const d = await svc.leadDossier(c, { leadId: "L1" });
    expect(d.client).toEqual({
      client_id: "C1",
      name: "Tema Shipping SA",
      public_reference_consent: "NAMED",
    });
  });

  test("the timeline reads this lead's own ref from the immutable ledger", async () => {
    const c = clientOf([[/FROM lead l/, [LEAD_ROW]]]);
    await svc.leadDossier(c, { leadId: "L1" });
    const ledger = c.calls.find((x) => /immutable_ledger/.test(x.sql));
    expect(ledger).toBeTruthy();
    expect(ledger.params[0]).toBe("lead:L1");
  });

  test("discovery sections land on the meeting they belong to", async () => {
    const c = clientOf([
      [/FROM meeting m/, [{ meeting_id: "M1" }, { meeting_id: "M2" }]],
      [
        /FROM meeting_discovery_section/,
        [
          { meeting_id: "M1", section_key: "OPERATIONS", has_body: true, capture_state: "TYPED" },
          { meeting_id: "M2", section_key: "PAIN_POINTS", has_body: false, capture_state: "FAILED" },
          { meeting_id: "M1", section_key: "STRATEGY", has_body: true, capture_state: "TRANSCRIBED" },
        ],
      ],
    ]);
    const [m1, m2] = await svc.leadMeetings(c, "L1");
    expect(m1.sections.map((s) => s.section_key)).toEqual(["OPERATIONS", "STRATEGY"]);
    expect(m2.sections.map((s) => s.section_key)).toEqual(["PAIN_POINTS"]);
    // A section whose dictation failed must be visibly in that state rather
    // than silently empty — F1's definition of done.
    expect(m2.sections[0].capture_state).toBe("FAILED");
    expect(m2.sections[0].has_body).toBe(false);
  });

  test("no meetings means no second query for their sections", async () => {
    const c = clientOf([]);
    expect(await svc.leadMeetings(c, "L1")).toEqual([]);
    expect(c.calls.some((x) => /meeting_discovery_section/.test(x.sql))).toBe(false);
  });
});

describe("intakeDossier", () => {
  const REQ = {
    quote_request_id: "Q1",
    public_ref: "SQ-2026-0001",
    status: "RECEIVED",
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  };

  test("conversion is read from the FK, never from the status value", async () => {
    // A row whose STATUS claims conversion but which carries no opportunity id.
    // The legacy believed the status; this must not.
    const c = clientOf([
      [/FROM quote_request q/, [{ ...REQ, status: "CONVERTED_TO_OPPORTUNITY", converted_opportunity_id: null }]],
    ]);
    const d = await svc.intakeDossier(c, { quoteRequestId: "Q1" });
    expect(d.kpis.is_converted).toBe(false);
    expect(d.converted_opportunity).toBeNull();
  });

  test("a converted request carries its opportunity", async () => {
    const c = clientOf([
      [/FROM quote_request q/, [{ ...REQ, converted_opportunity_id: "O9", converted_at: REQ.created_at }]],
      [/FROM opportunity o/, [{ opportunity_id: "O9", name: "Tema lane", estimated_value: "5000000" }]],
    ]);
    const d = await svc.intakeDossier(c, { quoteRequestId: "Q1", canSeeFinancials: true });
    expect(d.kpis.is_converted).toBe(true);
    expect(d.converted_opportunity.name).toBe("Tema lane");
    expect(d.kpis.converted_value).toBe(5000000);
  });

  test("age counts days open, and stops counting once converted", async () => {
    const open = clientOf([[/FROM quote_request q/, [REQ]]]);
    expect((await svc.intakeDossier(open, { quoteRequestId: "Q1" })).kpis.age_days).toBe(3);

    const converted = clientOf([
      [
        /FROM quote_request q/,
        [{ ...REQ, converted_opportunity_id: "O9", converted_at: new Date(new Date(REQ.created_at).getTime() + 86400000).toISOString() }],
      ],
    ]);
    expect((await svc.intakeDossier(converted, { quoteRequestId: "Q1" })).kpis.age_days).toBe(1);
  });

  test("proposals are reached through the lead, and skipped when there is none", async () => {
    const noLead = clientOf([[/FROM quote_request q/, [REQ]]]);
    const d = await svc.intakeDossier(noLead, { quoteRequestId: "Q1" });
    expect(d.proposals).toEqual([]);
    expect(d.lead).toBeNull();
    expect(noLead.calls.some((x) => /FROM proposal p/.test(x.sql))).toBe(false);

    const withLead = clientOf([
      [/FROM quote_request q/, [{ ...REQ, lead_id: "L1", lead_company_name: "Tema Shipping" }]],
      [/FROM proposal p/, [{ proposal_id: "P1", total: "100" }]],
    ]);
    const d2 = await svc.intakeDossier(withLead, { quoteRequestId: "Q1", canSeeFinancials: true });
    expect(d2.lead).toEqual({ lead_id: "L1", company_name: "Tema Shipping", status: undefined });
    expect(d2.proposals).toHaveLength(1);
  });

  test("an unknown request is a 404", async () => {
    await expect(
      svc.intakeDossier(clientOf([]), { quoteRequestId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  test("attachments put the primary first", async () => {
    const c = clientOf([[/FROM quote_request_attachment/, [{ kind: "PRIMARY" }, { kind: "ADDITIONAL" }]]]);
    await svc.intakeAttachments(c, "Q1");
    const sql = c.calls[0].sql;
    expect(sql).toMatch(/ORDER BY \(a\.kind = 'PRIMARY'\) DESC/);
  });
});

describe("no cost or margin column is named in any query", () => {
  /**
   * Rule 1 of doc/SALES_CRM_FEATURES.md is about model input, and nothing here
   * reaches a model — but the discipline is cheap to keep and this is the file
   * that would quietly break it, since a dossier is exactly where somebody
   * would be tempted to add "profitability".
   */
  test("the service source mentions no cost or margin field", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/modules/sales/sales-360.service.js"),
      "utf8",
    );
    // Strip comments — the header discusses the rule by name.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["margin", "cost_", "_cost", "buy_price", "profit"]) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });
});
