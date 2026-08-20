"use strict";

/**
 * §2.1 — the merged reconciliation: the variance block (three questions) and
 * the AI matcher that proposes dictionary mappings for untagged actuals.
 * The matcher may PROPOSE, never confirm — confirming is a human act tested
 * in the service suite (dossier-reconciliation-g19.test.js).
 */
const rules = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.rules");
const service = require("../../src/modules/costing/dossier_reconciliation/dossier_reconciliation.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const UUID = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("computeVarianceBlock — the three questions", () => {
  test("quoted/budget/actual → quote_vs_budget, budget_vs_actual, quote_vs_actual", () => {
    const v = rules.computeVarianceBlock(
      { quoted_ht: 1200, budget_ht: 1000, actual_ht: 900 },
      {},
    );
    expect(v.quote_vs_budget).toBe(200); // did we quote it right
    expect(v.budget_vs_actual).toBe(100); // did we execute to plan
    expect(v.quote_vs_actual).toBe(300); // did we make money
    expect(v.margin_percent).toBe(25);
    expect(v.flag).toBe("GREEN");
  });

  test("no quotation → only the execution question is answered", () => {
    const v = rules.computeVarianceBlock(
      { quoted_ht: null, budget_ht: 500, actual_ht: 600 },
      {},
    );
    expect(v.budget_vs_actual).toBe(-100);
    expect(v.quote_vs_budget).toBeNull();
    expect(v.quote_vs_actual).toBeNull();
    expect(v.margin_percent).toBeNull();
    expect(v.flag).toBeNull();
  });

  test("tenant thresholds drive the flag", () => {
    const v = rules.computeVarianceBlock(
      { quoted_ht: 1000, budget_ht: 900, actual_ht: 880 },
      { green_min: 30, yellow_min: 5 },
    );
    expect(v.margin_percent).toBe(12);
    expect(v.flag).toBe("YELLOW");
  });
});

describe("proposeMapping — the matcher proposes, never invents", () => {
  const items = [
    {
      dictionary_item_id: UUID(1),
      item_code: "DOUANE",
      item_label: "Frais de douane",
      budget_ht: 500000,
      actual_ht: 100000,
    },
    {
      dictionary_item_id: UUID(2),
      item_code: "TRANSPORT",
      item_label: "Transport terrestre",
      budget_ht: 300000,
      actual_ht: 0,
    },
  ];

  test("matches an entry label to the item, accents and case ignored", () => {
    const best = rules.proposeMapping(
      { category: "frais Douane import", amount: 400000 },
      items,
    );
    expect(best).not.toBeNull();
    expect(best.dictionary_item_id).toBe(UUID(1));
    expect(best.confidence).toBeGreaterThanOrEqual(rules.MIN_CONFIDENCE);
    expect(best.reason).toMatch(/DOUANE/);
  });

  test("amount proximity to the remaining budget breaks ties", () => {
    // Label alone matches both TRANSPORT items equally badly; the amount that
    // ≈ TRANSPORT's remaining budget should tip it there.
    const twins = [
      {
        dictionary_item_id: UUID(3),
        item_code: "TRANSPORT",
        item_label: "Transport A",
        budget_ht: 300000,
        actual_ht: 0,
      },
      {
        dictionary_item_id: UUID(4),
        item_code: "TRANSPORT",
        item_label: "Transport B",
        budget_ht: 50000,
        actual_ht: 0,
      },
    ];
    const best = rules.proposeMapping(
      { category: "transport", amount: 300000 },
      twins,
    );
    expect(best.dictionary_item_id).toBe(UUID(3));
  });

  test("returns null below the confidence floor — a guess is worse than a blank", () => {
    expect(
      rules.proposeMapping(
        { category: "zzz unrelated thing", amount: 12 },
        items,
      ),
    ).toBeNull();
    expect(rules.proposeMapping({ category: "", amount: 0 }, items)).toBeNull();
  });

  test("an item with no remaining budget scores no amount signal", () => {
    const spent = [
      {
        dictionary_item_id: UUID(5),
        item_code: "DEMURRAGE",
        item_label: "Demurrage",
        budget_ht: 100,
        actual_ht: 100,
      },
    ];
    // name still matches, amount cannot help
    const best = rules.proposeMapping(
      { category: "demurrage", amount: 100 },
      spent,
    );
    expect(best).not.toBeNull();
    expect(rules.amountScore(100, spent[0])).toBe(0);
  });
});

describe("confirm/reject a suggestion — human-only, DRAFT-only", () => {
  function fakeClient({
    status = "DRAFT",
    suggestionStatus = "PROPOSED",
  } = {}) {
    const queries = [];
    const c = {
      queries,
      async query(sql, params) {
        queries.push({ sql, params });
        if (/FROM dossier_reconciliation WHERE reconciliation_id/.test(sql))
          return {
            rows: [
              {
                reconciliation_id: UUID(1),
                dossier_id: UUID(2),
                status,
                quoted_ht: null,
              },
            ],
          };
        if (
          /FROM dossier_reconciliation_suggestion WHERE suggestion_id/.test(sql)
        )
          return {
            rows: [
              {
                suggestion_id: UUID(7),
                reconciliation_id: UUID(1),
                cost_entry_id: UUID(8),
                suggested_dictionary_item_id: UUID(9),
                status: suggestionStatus,
              },
            ],
          };
        if (/UPDATE dossier_reconciliation_suggestion/.test(sql))
          return { rows: [{ suggestion_id: UUID(7), status: params[1] }] };
        if (/FULL OUTER JOIN/.test(sql)) return { rows: [] };
        if (/COALESCE\(\(SELECT SUM/.test(sql))
          return { rows: [{ budget_ht: 0, actual_ht: 0 }] };
        return { rows: [] };
      },
    };
    return c;
  }
  const actor = { user_id: UUID(3) };

  test("confirm stamps the item onto the cost entry and rebuilds the lines", async () => {
    const c = fakeClient();
    await service.confirmSuggestion(c, {
      id: UUID(1),
      suggestionId: UUID(7),
      actor,
    });
    const stamp = c.queries.find((q) =>
      /UPDATE cost_entry SET dictionary_item_id/.test(q.sql),
    );
    expect(stamp).toBeDefined();
    expect(stamp.params).toEqual([UUID(8), UUID(9)]);
    expect(
      c.queries.some((q) =>
        /DELETE FROM dossier_reconciliation_line/.test(q.sql),
      ),
    ).toBe(true);
    // atomic: the stamp + rebuild ride one transaction
    expect(c.queries.some((q) => /^BEGIN$/.test(q.sql))).toBe(true);
    expect(c.queries.some((q) => /^COMMIT$/.test(q.sql))).toBe(true);
  });

  test("refuses outside DRAFT — the figures are attested at submit", async () => {
    const c = fakeClient({ status: "SUBMITTED" });
    await expect(
      service.confirmSuggestion(c, {
        id: UUID(1),
        suggestionId: UUID(7),
        actor,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a suggestion that was already decided", async () => {
    const c = fakeClient({ suggestionStatus: "REJECTED" });
    await expect(
      service.confirmSuggestion(c, {
        id: UUID(1),
        suggestionId: UUID(7),
        actor,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("reject leaves the cost entry untouched", async () => {
    const c = fakeClient();
    await service.rejectSuggestion(c, {
      id: UUID(1),
      suggestionId: UUID(7),
      actor,
    });
    expect(c.queries.some((q) => /UPDATE cost_entry/.test(q.sql))).toBe(false);
    expect(
      c.queries.some((q) =>
        /UPDATE dossier_reconciliation_suggestion/.test(q.sql),
      ),
    ).toBe(true);
  });
});
