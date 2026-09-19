"use strict";

/**
 * C-PR-02 — FX sync operations + rate-history contract (Currency audit #3/#6/#9).
 *
 * Pins the operational hardening around the sync core WITHOUT a live provider:
 *   - service.syncNow opens a fx_sync_run, then stamps its outcome:
 *       · a real success → status 'ok', updated_count set;
 *       · a run with unsupported quotes → status 'partial';
 *       · a skip (no key) → status 'skipped' with the reason;
 *       · a thrown provider error → status 'error' with the message, rethrown.
 *   - service.setRate persists the actor (set_by_user_id) on the rate row.
 *
 * The sync core (currency.sync.syncRates) is stubbed via jest.mock so no HTTP is
 * attempted; the fake client records every query so the run-log writes and the
 * upsert actor param are asserted directly.
 */

jest.mock("../../src/modules/master/currency/currency.sync");
const sync = require("../../src/modules/master/currency/currency.sync");
const service = require("../../src/modules/master/currency/currency.service");

/**
 * A fake tenant client. Answers the tx-helper SAVEPOINT probe + BEGIN/COMMIT,
 * the fx_sync_run INSERT/UPDATE, and the fx_rate_daily upsert. Everything else
 * (emitEvent, audit) falls through to empty rows.
 */
function fakeClient() {
  const queries = [];
  const runInserts = [];
  const runUpdates = [];
  const upserts = [];
  return {
    queries,
    runInserts,
    runUpdates,
    upserts,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SAVEPOINT/i.test(sql)) return { rows: [] };
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      if (/INSERT INTO fx_sync_run/i.test(sql)) {
        runInserts.push(params);
        return { rows: [{ fx_sync_run_id: "run-1" }] };
      }
      if (/UPDATE fx_sync_run/i.test(sql)) {
        runUpdates.push(params);
        return { rows: [] };
      }
      if (/INSERT INTO fx_rate_daily/i.test(sql)) {
        upserts.push(params);
        return { rows: [{ base_code: params[0], quote_code: params[1], rate: params[2], source: params[4], is_override: params[5], set_by_user_id: params[6] }] };
      }
      return { rows: [] };
    },
  };
}

afterEach(() => jest.clearAllMocks());

describe("service.syncNow — sync-run recording (audit #6)", () => {
  it("records status 'ok' and the updated count on a clean run", async () => {
    sync.syncRates.mockResolvedValue({ skipped: false, base: "XAF", updated: [{ quote: "USD", rate: 0.0016 }, { quote: "EUR", rate: 0.0015 }], unsupported: [] });
    const c = fakeClient();
    await service.syncNow(c, { user_id: "u-1" });
    expect(c.runInserts).toHaveLength(1);
    expect(c.runUpdates).toHaveLength(1);
    // finishSyncRun params: [id, status, updatedCount, unsupported, reason, base]
    const [, status, updatedCount] = c.runUpdates[0];
    expect(status).toBe("ok");
    expect(updatedCount).toBe(2);
  });

  it("records status 'partial' when the provider had no rate for some quotes", async () => {
    sync.syncRates.mockResolvedValue({ skipped: false, base: "XAF", updated: [{ quote: "USD", rate: 0.0016 }], unsupported: ["ZZZ"] });
    const c = fakeClient();
    await service.syncNow(c, {});
    const [, status, updatedCount, unsupported] = c.runUpdates[0];
    expect(status).toBe("partial");
    expect(updatedCount).toBe(1);
    expect(unsupported).toEqual(["ZZZ"]);
  });

  it("records status 'skipped' with the reason when no key is configured", async () => {
    sync.syncRates.mockResolvedValue({ skipped: true, reason: "No exchangerate-api key configured." });
    const c = fakeClient();
    await service.syncNow(c, {});
    const [, status, , , reason] = c.runUpdates[0];
    expect(status).toBe("skipped");
    expect(reason).toMatch(/No exchangerate-api key/);
  });

  it("records status 'error' with the message and rethrows on a provider failure", async () => {
    sync.syncRates.mockRejectedValue(new Error("exchangerate-api: HTTP 500"));
    const c = fakeClient();
    await expect(service.syncNow(c, {})).rejects.toThrow(/HTTP 500/);
    const [, status, , , reason] = c.runUpdates[0];
    expect(status).toBe("error");
    expect(reason).toMatch(/HTTP 500/);
  });

  it("marks the run with the trigger passed (manual vs cron)", async () => {
    sync.syncRates.mockResolvedValue({ skipped: false, base: "XAF", updated: [], unsupported: [] });
    const c = fakeClient();
    await service.syncNow(c, {}, { trigger: "cron" });
    // startSyncRun params: [base, trigger, actorUserId]
    expect(c.runInserts[0][1]).toBe("cron");
  });
});

describe("service.setRate — override actor persistence (audit #9)", () => {
  it("writes the actor user id onto the rate row", async () => {
    const c = fakeClient();
    await service.setRate(c, { base: "XAF", quote: "USD", rate: 0.0016, actor: { user_id: "u-42" } });
    // upsertRate params: [base, quote, rate, asOfDate, source, isOverride, setByUserId]
    expect(c.upserts).toHaveLength(1);
    expect(c.upserts[0][6]).toBe("u-42");
    expect(c.upserts[0][5]).toBe(true); // is_override
  });

  it("stores null actor for a system/unattributed write", async () => {
    const c = fakeClient();
    await service.setRate(c, { base: "XAF", quote: "USD", rate: 0.0016, actor: {} });
    expect(c.upserts[0][6]).toBeNull();
  });
});
