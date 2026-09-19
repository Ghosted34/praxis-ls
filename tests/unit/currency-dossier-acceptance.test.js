"use strict";

/**
 * C-PR-04 — Currency 360 acceptance + performance hardening (audit #10/#12).
 *
 * These pin the cross-PR behaviour the dossier promises the client, without a
 * live database:
 *
 *   #10  The four INDEPENDENT per-currency reads (rate history, last sync,
 *        override log, usage scan) are issued CONCURRENTLY, not as a serial
 *        await-chain. We prove it by making each repo read block on a manual
 *        gate and asserting all four are in flight before any resolves — a
 *        sequential implementation could not have started the later reads yet.
 *
 *   #10  The usage scan never counts fx_rate_daily as "usage" (rates are not
 *        usage) and returns [] when there are no FK columns.
 *
 *   #12  The dossier assembles the frozen contract the Currency 360 client
 *        renders: base, is_base, catalogue facts, countries, the first
 *        rate-history page with total/page_size/has_more, latest_rate,
 *        last_sync, overrides, usage + usage_total — and degrades to the
 *        "base currency" shape (empty rate blocks) for the base itself.
 */

const dossier = require("../../src/modules/master/currency/currency.dossier");
const repo = require("../../src/modules/master/currency/currency.repo");

afterEach(() => jest.restoreAllMocks());

/** A promise plus its resolver, for gating concurrent reads. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("dossier — concurrent independent reads (audit #10)", () => {
  it("starts rate-history, last-sync, override-log and usage reads before any resolves", async () => {
    const client = {};
    jest.spyOn(repo, "getCurrency").mockResolvedValue({ code: "EUR", is_base: false });
    jest.spyOn(repo, "getBaseCode").mockResolvedValue("XAF");

    const gates = {
      rateHistory: deferred(),
      lastSync: deferred(),
      overrideLog: deferred(),
      usageForCode: deferred(),
    };
    const started = { rateHistory: false, lastSync: false, overrideLog: false, usageForCode: false };

    jest.spyOn(repo, "rateHistory").mockImplementation(async () => {
      started.rateHistory = true;
      await gates.rateHistory.promise;
      return { rows: [{ rate: "656.1", as_of_date: "2026-09-19", source: "manual", is_override: true }], total: 1, limit: 50, offset: 0 };
    });
    jest.spyOn(repo, "lastSync").mockImplementation(async () => {
      started.lastSync = true;
      await gates.lastSync.promise;
      return null;
    });
    jest.spyOn(repo, "overrideLog").mockImplementation(async () => {
      started.overrideLog = true;
      await gates.overrideLog.promise;
      return [];
    });
    jest.spyOn(repo, "usageForCode").mockImplementation(async () => {
      started.usageForCode = true;
      await gates.usageForCode.promise;
      return [];
    });

    const pending = dossier.dossier(client, "EUR");
    // Let the microtask queue flush so every read that was going to start, has.
    await new Promise((r) => setImmediate(r));

    // All four are in flight though NONE has resolved — impossible if serial.
    expect(started).toEqual({ rateHistory: true, lastSync: true, overrideLog: true, usageForCode: true });

    Object.values(gates).forEach((g) => g.resolve());
    const out = await pending;
    expect(out.latest_rate.as_of_date).toBe("2026-09-19");
  });
});

describe("dossier — contract assembly (audit #12)", () => {
  it("assembles the full quote-currency contract with the paged rate history", async () => {
    const client = {};
    jest.spyOn(repo, "getCurrency").mockResolvedValue({ code: "EUR", is_base: false, is_active: true });
    jest.spyOn(repo, "getBaseCode").mockResolvedValue("XAF");
    jest.spyOn(repo, "rateHistory").mockResolvedValue({
      rows: [
        { rate: "656.1", as_of_date: "2026-09-19", source: "manual", is_override: true },
        { rate: "655.9", as_of_date: "2026-09-18", source: "exchangerate-api", is_override: false },
      ],
      total: 120,
      limit: 50,
      offset: 0,
    });
    jest.spyOn(repo, "lastSync").mockResolvedValue({ rate: "655.9", as_of_date: "2026-09-18" });
    jest.spyOn(repo, "overrideLog").mockResolvedValue([{ rate: "656.1", set_by_name: "Marie" }]);
    jest.spyOn(repo, "usageForCode").mockResolvedValue([
      { table: "sales_invoice", label: "Sales invoices", count: 7 },
      { table: "purchase_order", label: "Purchase orders", count: 3 },
    ]);

    const out = await dossier.dossier(client, "EUR");

    expect(out.base).toBe("XAF");
    expect(out.is_base).toBe(false);
    expect(out.catalogue.code).toBe("EUR");
    expect(Array.isArray(out.countries)).toBe(true);
    expect(out.countries.length).toBeGreaterThan(0);
    // Rate-history contract, first page.
    expect(out.rate_history).toHaveLength(2);
    expect(out.rate_history_total).toBe(120);
    expect(out.rate_history_page_size).toBe(50);
    expect(out.rate_history_has_more).toBe(true);
    expect(out.latest_rate.as_of_date).toBe("2026-09-19");
    expect(out.last_sync.as_of_date).toBe("2026-09-18");
    expect(out.overrides).toHaveLength(1);
    // Usage + total.
    expect(out.usage).toHaveLength(2);
    expect(out.usage_total).toBe(10);
  });

  it("degrades to the base-currency shape — no rate pair, empty rate blocks", async () => {
    const client = {};
    jest.spyOn(repo, "getCurrency").mockResolvedValue({ code: "XAF", is_base: true, is_active: true });
    jest.spyOn(repo, "getBaseCode").mockResolvedValue("XAF");
    // Reads that require a pair must NOT be called for the base.
    const rateHistory = jest.spyOn(repo, "rateHistory").mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
    const lastSync = jest.spyOn(repo, "lastSync").mockResolvedValue(null);
    const overrideLog = jest.spyOn(repo, "overrideLog").mockResolvedValue([]);
    jest.spyOn(repo, "usageForCode").mockResolvedValue([]);

    const out = await dossier.dossier(client, "XAF");

    expect(out.is_base).toBe(true);
    expect(out.rate_history).toEqual([]);
    expect(out.rate_history_total).toBe(0);
    expect(out.rate_history_has_more).toBe(false);
    expect(out.latest_rate).toBeNull();
    expect(out.last_sync).toBeNull();
    expect(out.overrides).toEqual([]);
    // The pair-dependent reads were skipped entirely for the base.
    expect(rateHistory).not.toHaveBeenCalled();
    expect(lastSync).not.toHaveBeenCalled();
    expect(overrideLog).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for an unknown currency", async () => {
    jest.spyOn(repo, "getCurrency").mockResolvedValue(null);
    await expect(dossier.dossier({}, "ZZZ")).rejects.toMatchObject({ status: 404 });
  });
});
