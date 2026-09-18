/**
 * Workspace Analytics — the window, the shaping, and the reconciliation rules.
 *
 * ── WHAT IS WORTH TESTING IN A DASHBOARD ───────────────────────────────────
 *
 * Not "does it return numbers". The failures that matter on an aggregate screen
 * are the ones that produce a PLAUSIBLE wrong number, because nobody checks a
 * plausible number:
 *
 *   · a window a URL can widen without bound, which is a full table scan the
 *     user can trigger by editing a query string;
 *   · panels that disagree — a summary saying 42 open beside a workload table
 *     adding to 43 — which destroys trust in the whole screen and cannot be
 *     debugged from a screenshot;
 *   · a chart whose x-axis changes shape as data arrives, so two screenshots
 *     of the same report are not comparable;
 *   · a burn-down whose running total is computed twice, once for the chart
 *     and once for the accessible table, and drifts by a day between them.
 *
 * And one rule with no numeric symptom at all: this screen reports operational
 * throughput, never anybody's appraisal. That is asserted here as the absence
 * of the columns, because a rule with no test is a rule until someone is busy.
 */
"use strict";

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const repo = require("../../src/modules/dashboard/workspace/tasks.repo");

const ME = "11111111-1111-1111-1111-111111111111";
const DAY = 86400000;

function mockClient(rowsFor = () => []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: rowsFor(sql, params) || [], rowCount: 0 };
    },
  };
}

/**
 * A client that answers nothing, so the tenant clock falls back to its default.
 *
 * The fallback is the tenant default (`Africa/Douala`, UTC+1) rather than UTC,
 * which is exactly the property worth pinning: a bare date must never be read
 * as a UTC midnight.
 */
const TENANT_TZ = "Africa/Douala";
const tzClient = () => mockClient(() => []);

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

describe("resolveAnalyticsWindow — a URL cannot ask for the whole history", () => {
  it("defaults to the last 30 days when no window is named", async () => {
    const w = await service.resolveAnalyticsWindow(tzClient(), {});
    expect(days(w.from, w.to)).toBe(service.ANALYTICS_DEFAULT_DAYS);
    expect(w.clamped).toBe(false);
  });

  it("honours a window inside the limit exactly", async () => {
    const w = await service.resolveAnalyticsWindow(tzClient(), {
      from: "2026-01-01",
      to: "2026-03-01",
    });
    expect(w.clamped).toBe(false);
    expect(days(w.from, w.to)).toBe(59);
  });

  it("narrows an over-wide window instead of scanning the table", async () => {
    const w = await service.resolveAnalyticsWindow(tzClient(), {
      from: "2015-01-01",
      to: "2026-01-01",
    });
    expect(days(w.from, w.to)).toBe(service.ANALYTICS_MAX_DAYS);
    // And SAYS it narrowed, so the screen can tell the user it answered a
    // different question from the one the URL asked.
    expect(w.clamped).toBe(true);
  });

  it("treats an inverted range as the typo it is, rather than as no data", async () => {
    const w = await service.resolveAnalyticsWindow(tzClient(), {
      from: "2026-06-01",
      to: "2026-01-01",
    });
    expect(w.clamped).toBe(true);
    expect(new Date(w.from).getTime()).toBeLessThan(new Date(w.to).getTime());
    expect(days(w.from, w.to)).toBe(service.ANALYTICS_DEFAULT_DAYS);
  });

  it("resolves a bare date on the TENANT's clock, not the server's", async () => {
    // A Lagos day starts at 23:00Z the evening before. Reading it as UTC puts
    // an hour of yesterday's work into today's bar, every day, invisibly.
    const w = await service.resolveAnalyticsWindow(tzClient(), {
      from: "2026-03-02",
      to: "2026-03-03",
    });
    expect(w.timeZone).toBe(TENANT_TZ);
    expect(w.from).toBe("2026-03-01T23:00:00.000Z");
  });
});

describe("fillBuckets — an axis that keeps its shape", () => {
  it("returns every band in reading order, empty ones as zero", () => {
    const out = service.fillBuckets([{ bucket: "3-7", tasks: 4 }], service.AGE_BUCKETS);
    expect(out.map((b) => b.bucket)).toEqual(["<1", "1-2", "3-7", "8-30", "30+"]);
    expect(out.map((b) => b.tasks)).toEqual([0, 0, 4, 0, 0]);
  });

  it("orders bands by age rather than alphabetically", () => {
    // Sorted as text, "30+" lands between "3-7" and "8-30" and the histogram
    // reads as noise.
    const out = service.fillBuckets([], service.AGE_BUCKETS);
    expect(out[out.length - 1].bucket).toBe("30+");
  });

  it("carries an average through when the aggregate supplies one", () => {
    const out = service.fillBuckets([{ bucket: "1-2", tasks: 2, avg_days: "1.5" }], service.AGE_BUCKETS);
    expect(out[1].avg_days).toBe(1.5);
    expect(out[0].avg_days).toBeUndefined();
  });
});

describe("burndownSeries — one running total, shared by the chart and the table", () => {
  const input = {
    open_at_start: 10,
    days: [
      { day: "2026-09-01", created: 3, completed: 1 },
      { day: "2026-09-02", created: 0, completed: 4 },
      { day: "2026-09-03", created: 2, completed: 2 },
    ],
  };

  it("accumulates the backlog forward from the opening balance", () => {
    expect(service.burndownSeries(input).days.map((d) => d.open)).toEqual([12, 8, 8]);
  });

  it("keeps the opening balance, so the line starts where the period did", () => {
    // Without it the chart starts at whatever the first day's delta was and
    // the slope is a fiction.
    expect(service.burndownSeries(input).open_at_start).toBe(10);
  });

  it("preserves the per-day numbers the accessible table prints", () => {
    const out = service.burndownSeries(input);
    expect(out.days[1]).toEqual({ day: "2026-09-02", created: 0, completed: 4, open: 8 });
  });

  it("copes with an empty period without inventing a point", () => {
    expect(service.burndownSeries({ open_at_start: 0, days: [] })).toEqual({
      open_at_start: 0,
      days: [],
    });
  });
});

describe("every panel answers for the SAME population", () => {
  // The same object `visibilityOf` builds, so the predicate under test is the
  // one production compiles rather than a string invented by the test.
  const visibility = { audience: "mine", userId: ME, scopeIds: null, personalOnly: true };
  const args = {
    visibility,
    filters: { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", status: null, priority: null, assignedTo: null, scopeId: null },
    nowIso: "2026-09-01T00:00:00.000Z",
    timeZone: "Africa/Lagos",
  };
  const panels = [
    "analyticsSummary",
    "analyticsThroughput",
    "analyticsOverdueAging",
    "analyticsWorkload",
    "analyticsCycleTime",
    "analyticsBlocked",
    "analyticsBurndown",
    "analyticsComposition",
  ];

  it("applies the caller's visibility predicate in every aggregate", async () => {
    for (const panel of panels) {
      const client = mockClient(() => []);
      await repo[panel](client, args);
      for (const call of client.calls) {
        // A panel that forgot the predicate leaks a tenant-wide count through
        // an aggregate — no titles, but the number itself is the disclosure.
        expect(call.sql).toMatch(/t\.assigned_to = \$\d+ OR t\.created_by = \$\d+/);
        expect(call.params).toContain(ME);
      }
    }
  });

  it("excludes deleted tasks from every aggregate", async () => {
    for (const panel of panels) {
      const client = mockClient(() => []);
      await repo[panel](client, args);
      for (const call of client.calls) {
        expect(call.sql).toMatch(/is_deleted = false/);
      }
    }
  });

  it("binds every placeholder it references, in every aggregate", async () => {
    for (const panel of panels) {
      const client = mockClient(() => []);
      await repo[panel](client, args);
      for (const { sql, params } of client.calls) {
        let max = 0;
        for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
        expect(max).toBeLessThanOrEqual(params.length);
      }
    }
  });

  it("buckets days on the tenant's clock, not the database's", async () => {
    for (const panel of ["analyticsThroughput", "analyticsBurndown"]) {
      const client = mockClient(() => []);
      await repo[panel](client, args);
      const sql = client.calls.map((c) => c.sql).join("\n");
      expect(sql).toMatch(/AT TIME ZONE/);
    }
  });
});

describe("the aggregates are operational, and structurally cannot be otherwise", () => {
  const args = {
    visibility: { audience: "all", userId: ME, scopeIds: null, personalOnly: true },
    filters: { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z", status: null, priority: null, assignedTo: null, scopeId: null },
    nowIso: "2026-09-01T00:00:00.000Z",
    timeZone: "Africa/Lagos",
  };

  it("reads no appraisal, compensation or rating table anywhere", async () => {
    // The recorded product boundary: this screen shows what the work is doing,
    // never what a person is worth. Asserted as the absence of the join,
    // because the moment one of these appears the screen has changed category
    // and needs a different permission and a different conversation.
    const forbidden =
      /\b(appraisal|performance_review|kpi|rating|score|salary|compensation|payroll|pay_grade|bonus)\b/i;
    for (const panel of [
      "analyticsSummary",
      "analyticsThroughput",
      "analyticsOverdueAging",
      "analyticsWorkload",
      "analyticsCycleTime",
      "analyticsBlocked",
      "analyticsBurndown",
      "analyticsComposition",
    ]) {
      const client = mockClient(() => []);
      await repo[panel](client, args);
      for (const { sql } of client.calls) expect(sql).not.toMatch(forbidden);
    }
  });

  it("reports workload as counts of work, not as a per-person verdict", async () => {
    const client = mockClient(() => []);
    await repo.analyticsWorkload(client, args);
    const { sql } = client.calls[0];
    expect(sql).toMatch(/open_tasks/);
    expect(sql).toMatch(/overdue_tasks/);
    // No ranking, no percentage-of-target, nothing that reads as a league table.
    expect(sql).not.toMatch(/RANK\(\)|DENSE_RANK|ROW_NUMBER\(\) OVER \(ORDER BY/i);
  });
});

describe("analytics() — one read, one instant, one predicate", () => {
  const ctx = { user: { user_id: ME }, permission_scope: "all", scope_ids: [] };

  const SUMMARY = {
    open_count: 5, overdue_count: 2, blocked_count: 1,
    completed_count: 4, cancelled_count: 0, total_count: 9,
  };

  /** Answers the panels that need a row to exist, and nothing else. */
  function analyticsClient(extra = () => null) {
    return mockClient((sql, params) => {
      const hit = extra(sql, params);
      if (hit) return hit;
      if (/open_count/i.test(sql)) return [SUMMARY];
      return [];
    });
  }

  it("returns every panel the screen renders, so none of them has to guess", async () => {
    const out = await service.analytics(analyticsClient(), ctx, {});
    for (const key of [
      "window",
      "summary",
      "throughput",
      "overdue_aging",
      "workload",
      "cycle_time",
      "blocked",
      "burndown",
      "composition",
    ]) {
      expect(out).toHaveProperty(key);
    }
  });

  it("reports the window it actually used, including the clamp", async () => {
    const out = await service.analytics(analyticsClient(), ctx, { from: "2010-01-01", to: "2026-01-01" });
    expect(out.window.clamped).toBe(true);
    expect(out.window.max_days).toBe(service.ANALYTICS_MAX_DAYS);
    expect(out.window.timezone).toBe(TENANT_TZ);
  });

  it("echoes the filters back, so the drill-down link can carry them unchanged", async () => {
    const out = await service.analytics(analyticsClient(), ctx, {
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigned_to: "me",
    });
    expect(out.filters).toMatchObject({ status: "IN_PROGRESS", priority: "HIGH", assigned_to: "me" });
  });

  it("resolves `assigned_to=me` server-side rather than trusting a client id", async () => {
    const client = analyticsClient();
    await service.analytics(client, ctx, { assigned_to: "me" });
    const everyParam = client.calls.flatMap((c) => c.params);
    expect(everyParam).toContain(ME);
  });

  it("gives every blocked row a canonical link rather than a bare id", async () => {
    const client = analyticsClient((sql) => {
      if (/blocking_count/i.test(sql) && /t\.title/i.test(sql))
        return [
          {
            task_id: "t1",
            title: "File the return",
            status: "TO_DO",
            priority: "HIGH",
            due_at: null,
            assigned_to_name: "Ada",
            blocking_count: 2,
            blocked_since: "2026-08-20T09:00:00.000Z",
          },
        ];
      return null;
    });
    const out = await service.analytics(client, ctx, {});
    // The shared producer, so a drill-down from a chart lands on the same URL
    // as a link from anywhere else in the product.
    expect(out.blocked[0].link_url).toBe("/workspace/tasks?task=t1");
  });

  it("names the audience it answered at, and the ones the caller could ask for", async () => {
    const out = await service.analytics(analyticsClient(), ctx, {});
    expect(out.audience).toBeTruthy();
    expect(Array.isArray(out.audiences)).toBe(true);
  });
});
