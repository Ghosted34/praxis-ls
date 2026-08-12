"use strict";

/**
 * Two production faults the Error Command Center surfaced on its first day live.
 *
 * Both are regression-tested here because both were the kind that a passing
 * build says nothing about: one queried a table that has never existed in any
 * migration, the other threw away the provider's own explanation of why it
 * failed. Neither would be caught by anything that does not actually execute the
 * statement or the HTTP call.
 */

const path = require("path");

const TREASURY = "../../src/modules/master/treasury-360.service";
const SYNC = "../../src/modules/master/currency/currency.sync";

/* ═══════════════════════════════════════════════════════════════════════════
 * `relation "audit_log" does not exist`  ×4
 *   GET /api/tenant/treasury-accounts/:id/360   ·  Tenant · smartls
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("treasury 360 timeline reads event_log, not a table that never existed", () => {
  /** Capture the SQL `_timeline` issues, without a database. */
  function captureQuery() {
    const seen = [];
    const client = {
      query: async (sql, params) => {
        seen.push({ sql, params });
        return { rows: [] };
      },
    };
    return { client, seen };
  }

  const svc = require(TREASURY);

  it("queries immutable_ledger — audit_log is in NO tenant migration", async () => {
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 25);

    expect(seen[0].sql).toMatch(/FROM immutable_ledger/);
    // The whole incident in one assertion.
    expect(seen[0].sql).not.toMatch(/audit_log/);
  });

  it("uses the AUDIT table, not the event stream", async () => {
    // Both carry entity_ref and both are written on every treasury mutation, so
    // event_log looks like a plausible target and is the wrong one: it is the
    // workflow/notification stream (`event_type_key`, no before/after).
    // `audit()` in emit.js writes the real trail to immutable_ledger with
    // before/after payloads, which is what "every change to this account" means.
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 25);
    expect(seen[0].sql).not.toMatch(/event_log/);
  });

  it("returns the before/after snapshots the UI type declares", async () => {
    // immutable_ledger is a near-exact match for the table that was never
    // built: before_json/after_json ARE the missing before_snapshot/
    // after_snapshot. Nothing has to be faked as NULL.
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 25);

    expect(seen[0].sql).toMatch(/before_json AS before_snapshot/);
    expect(seen[0].sql).toMatch(/after_json AS after_snapshot/);
  });

  it("keeps the entity_ref that treasury_account.service.js actually writes", async () => {
    // `ref()` in treasury_account.service.js builds 'treasury_account:<id>' on
    // every create/update/verify, and ix_ledger_entity indexes the column.
    // This was the one part of the original query that was right.
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 25);
    expect(seen[0].params[0]).toBe("treasury_account:acc-1");
  });

  it("selects no column that immutable_ledger lacks", async () => {
    // Aliasing is what keeps the client (client/src/lib/treasury-api.ts)
    // unchanged — the UI reads audit_id/action/actor_user_id/occurred_at.
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 25);

    const sql = seen[0].sql;
    expect(sql).toMatch(/ledger_id AS audit_id/);
    expect(sql).toMatch(/created_at AS occurred_at/);
    // `action` and `actor_user_id` need no alias — same name on both.
    expect(sql).toMatch(/\baction\b/);
    // Ordering must follow the real column, not the alias.
    expect(sql).toMatch(/ORDER BY created_at DESC/);
  });

  it("clamps the limit rather than trusting the caller", async () => {
    const { client, seen } = captureQuery();
    await svc._timeline(client, "acc-1", 100000);
    expect(seen[0].params[1]).toBe(200);

    await svc._timeline(client, "acc-1", 0);
    expect(seen[1].params[1]).toBe(25);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * `AxiosError: Request failed with status code 404`  ×1
 *   job/fx-sync/sync  ·  worker  ·  nightly, 00:00 Africa/Douala
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("fx sync explains a provider failure instead of leaking an AxiosError", () => {
  const AXIOS = require.resolve("axios");
  const REPO =
    require.resolve("../../src/modules/master/currency/currency.repo");
  const SETTINGS = require.resolve("../../src/shared/config/settings");

  /**
   * `syncRates` with the provider and the key lookup doubled. The key resolves
   * through three tiers (integration_secret → setting → env); stubbing the
   * setting tier is enough to get past it.
   */
  function loadSync(httpResponse) {
    jest.resetModules();
    jest.doMock(AXIOS, () => ({ get: async () => httpResponse }));
    jest.doMock(REPO, () => ({
      getBaseCode: async () => "XAF",
      listActiveCodes: async () => ["USD", "EUR"],
      upsertRate: async () => ({}),
    }));
    jest.doMock(SETTINGS, () => ({ getSetting: async () => "a-test-key" }));

    return require(SYNC);
  }

  const client = { query: async () => ({ rows: [] }) };

  it("names the key as the cause on a 404 — the actual production failure", async () => {
    // The key is a PATH SEGMENT for this provider, so a stale or blank key makes
    // the whole URL a 404 rather than a 401. That is not obvious from
    // "Request failed with status code 404", which is all the job used to say.
    const sync = loadSync({ status: 404, data: "Not Found" });

    await expect(sync.syncRates(client, {})).rejects.toThrow(/404/);
    await expect(sync.syncRates(client, {})).rejects.toThrow(/API key/i);
  });

  it("never puts the API key in the error message", async () => {
    // This message is persisted to platform.error_event and rendered in the
    // Error Center. Interpolating the URL would put a live credential in the
    // error feed, in the export, and in the AI explain prompt.
    const sync = loadSync({ status: 404, data: "Not Found" });

    await expect(sync.syncRates(client, {})).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("a-test-key"),
      }),
    );
  });

  it("still surfaces a 200-with-error-body, which is the OTHER failure shape", async () => {
    // A recognised-but-rejected key returns HTTP 200 with result:"error".
    // Reaching this branch at all is what the change restored.
    const sync = loadSync({
      status: 200,
      data: { result: "error", "error-type": "invalid-key" },
    });
    await expect(sync.syncRates(client, {})).rejects.toThrow(/invalid-key/);
  });

  it("reports any other non-200 with its status", async () => {
    const sync = loadSync({ status: 503, data: {} });
    await expect(sync.syncRates(client, {})).rejects.toThrow(/HTTP 503/);
  });

  it("still succeeds on a good response", async () => {
    // The guard must not have broken the path that works.
    const sync = loadSync({
      status: 200,
      data: {
        result: "success",
        conversion_rates: { USD: 0.0016, EUR: 0.0015 },
      },
    });
    const out = await sync.syncRates(client, {});
    expect(out.base).toBe("XAF");
    expect(out.updated.map((u) => u.quote).sort()).toEqual(["EUR", "USD"]);
  });

  /*
   * The bug behind this test: on a fully successful sync the old shape returned
   * `skipped: []` — an empty array — and every consumer used JS truthiness on
   * that field (`if (!result.skipped)` in service.syncNow, `if (r.skipped)` in
   * currencies.tsx). Empty arrays are truthy, so the server never emitted the
   * `RATE_SYNCED` audit for a good run and the client permanently rendered
   * "Sync skipped — no API key configured." over green syncs, even after the
   * user pasted a working exchangerate-api key. `skipped` must be an
   * unambiguous boolean sentinel — the per-quote list lives on `unsupported`.
   */
  it("`skipped` is a boolean sentinel on success — never an array", async () => {
    const sync = loadSync({
      status: 200,
      data: {
        result: "success",
        conversion_rates: { USD: 0.0016, EUR: 0.0015 },
      },
    });
    const out = await sync.syncRates(client, {});
    expect(typeof out.skipped).toBe("boolean");
    expect(out.skipped).toBe(false);
  });

  it("`skipped: true` marks a real no-op — including no active quote currencies", async () => {
    // Same-shape sentinel whether the skip is "no key" or "no quotes"; both
    // must be recognisable with a single `result.skipped === true` check.
    jest.resetModules();
    jest.doMock(AXIOS, () => ({
      get: async () => ({ status: 200, data: {} }),
    }));
    jest.doMock(REPO, () => ({
      getBaseCode: async () => "XAF",
      listActiveCodes: async () => ["XAF"], // base filters itself out → zero quotes
      upsertRate: async () => ({}),
    }));
    jest.doMock(SETTINGS, () => ({ getSetting: async () => "a-test-key" }));
    const sync = require(SYNC);

    const out = await sync.syncRates({ query: async () => ({ rows: [] }) }, {});
    expect(out.skipped).toBe(true);
    expect(out.reason).toMatch(/no active quote currencies/);
  });

  it("codes the provider returned no rate for surface on `unsupported`, not `skipped`", async () => {
    // XAF→USD priced, XAF→XYZ absent from the provider payload. The old code
    // put "XYZ" into `skipped` (an array), which the consumers then read as
    // "the whole sync was skipped". It belongs on its own field.
    jest.resetModules();
    jest.doMock(AXIOS, () => ({
      get: async () => ({
        status: 200,
        data: { result: "success", conversion_rates: { USD: 0.0016 } },
      }),
    }));
    jest.doMock(REPO, () => ({
      getBaseCode: async () => "XAF",
      listActiveCodes: async () => ["USD", "XYZ"],
      upsertRate: async () => ({}),
    }));
    jest.doMock(SETTINGS, () => ({ getSetting: async () => "a-test-key" }));
    const sync = require(SYNC);

    const out = await sync.syncRates({ query: async () => ({ rows: [] }) }, {});
    expect(out.skipped).toBe(false);
    expect(out.updated.map((u) => u.quote)).toEqual(["USD"]);
    expect(out.unsupported).toEqual(["XYZ"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * `TypeError: repo.get is not a function`  ×6
 *   GET /api/tenant/service-types/:id/360   ·  Tenant · smartls
 *   Regression in 52c9305 (mod-29), merged the same day.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("service_type repo exposes findById, not get", () => {
  const { makeRepo } = require("../../src/shared/crud/resource");

  it("the factory draws the line: repo=findById, service=get", () => {
    // This is the whole bug. `repo.get` READS as safe because a dozen other
    // modules say exactly that — but those repos declare their own `get` on top
    // of the factory. service_type inherits only what makeRepo returns.
    const repo = makeRepo({ table: "t", pk: "t_id" });
    expect(typeof repo.findById).toBe("function");
    expect(repo.get).toBeUndefined();
  });

  it("service_type.repo has no `get` — so nothing may call one", () => {
    const repo = require("../../src/modules/operations/service_type/service_type.repo");
    expect(typeof repo.findById).toBe("function");
    expect(repo.get).toBeUndefined();
  });

  it("no module calls repo.get on a repo that lacks it", () => {
    // The scan that found the SECOND call site — `assertNotSystem`, on the
    // delete path, which had not fired only because nobody had deleted a
    // service type yet. Cheap to keep: it fails the moment someone writes
    // `repo.get` in a module whose repo does not define one.
    //
    // Walked with fs, not `execSync("grep …")`. The first version shelled out
    // and died on Windows with "'grep' is not recognized as an internal or
    // external command" — green on CI, red on every developer machine, which is
    // the worst way for a guard to fail.
    const fs = require("fs");

    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".js")) out.push(full);
      }
      return out;
    };

    const modules = path.join(__dirname, "../../src/modules");
    const broken = [];

    for (const file of walk(modules)) {
      if (!/\brepo\.get\(/.test(fs.readFileSync(file, "utf8"))) continue;

      const dir = path.dirname(file);
      const repoFile = fs.readdirSync(dir).find((x) => x.endsWith(".repo.js"));
      if (!repoFile) continue; // repo is injected, or lives elsewhere

      const repo = require(path.join(dir, repoFile));
      if (typeof repo.get !== "function")
        broken.push(path.relative(modules, file));
    }

    expect(broken).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * Overview read "Degraded" beside 100% uptime and 100% resolved
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("system health status describes NOW, not the last 24 hours", () => {
  const ERRORS = "../../src/services/platform/errors.service";
  const DB = require.resolve("../../src/services/platform/db");

  function statsWith(row) {
    jest.resetModules();
    jest.doMock(DB, () => ({ query: async () => ({ rows: [row] }) }));

    return require(ERRORS).stats({});
  }

  /** The widget's decision, mirrored so the rule is asserted, not just the data. */
  const label = (s) =>
    s.fatal_active > 0
      ? "Degraded"
      : s.active > 0
        ? "Errors logged"
        : s.today > 0
          ? "Recovered — all resolved"
          : "All systems operational";

  const BASE = {
    total_occurrences: "12",
    unique_errors: 5,
    fatal: 2,
    fatal_active: 0,
    errors: 3,
    warnings: 0,
    resolved: 5,
    active: 0,
    today: 5,
    avg_resolution_seconds: 120,
  };

  it("exposes fatal_active separately from the 24h fatal count", async () => {
    const s = await statsWith(BASE);
    // Both numbers are wanted, for different jobs: `fatal` is the KPI card
    // ("2 FATAL (24H)"), `fatal_active` is the status light.
    expect(s.fatal).toBe(2);
    expect(s.fatal_active).toBe(0);
  });

  it("does not say Degraded once everything is resolved — the reported card", async () => {
    // 100.00% UPTIME · 5 ERRORS TODAY · 2 FATAL (24H) · 100% RESOLVED · Degraded
    // A status that will not return to green after the work is done is one
    // people stop reading.
    const s = await statsWith(BASE);
    expect(s.resolved_rate).toBe(100);
    expect(label(s)).toBe("Recovered — all resolved");
  });

  it("still says Degraded while a fatal is OPEN", async () => {
    const s = await statsWith({
      ...BASE,
      fatal_active: 1,
      active: 1,
      resolved: 4,
    });
    expect(label(s)).toBe("Degraded");
  });

  it("says Errors logged for open non-fatal errors", async () => {
    const s = await statsWith({
      ...BASE,
      fatal_active: 0,
      active: 2,
      resolved: 3,
    });
    expect(label(s)).toBe("Errors logged");
  });

  it("says operational only when the window was genuinely quiet", async () => {
    // Distinct from "recovered": "we had five and fixed them all" and "nothing
    // happened" are different facts about the day.
    const s = await statsWith({
      ...BASE,
      fatal: 0,
      fatal_active: 0,
      active: 0,
      today: 0,
      resolved: 0,
      unique_errors: 0,
    });
    expect(label(s)).toBe("All systems operational");
  });
});

/** Guards the require paths above against a file move. */
it("both services are where this suite thinks they are", () => {
  expect(path.basename(require.resolve(TREASURY))).toBe(
    "treasury-360.service.js",
  );
  expect(path.basename(require.resolve(SYNC))).toBe("currency.sync.js");
});
