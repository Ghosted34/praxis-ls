"use strict";

/**
 * G16 — extra-charge simulator: five charge families, ported from the legacy
 * `extra-charges-simulator.php` the founder asked to be "copied as-is".
 *
 * Demurrage (two tiers, per size+type), storage (four day bands), yard
 * occupancy (one-off ≥ 14 days), plugging (reefers, ATA+1 → gate-out),
 * detention ((empty-return − gate-out) − 2 free days, dry vs reefer), with
 * 19.25% VAT. These tests pin the legacy rules with hand-computed values.
 */

const { parseContainers, simulateCharges, DEFAULT_RATES } = require("../../src/modules/commercial/extra_charge_simulation/extra_charge_simulation.rules");

describe("G16 — parseContainers (legacy free-text list)", () => {
  it("parses 2x40HC, 1x20RF", () => {
    expect(parseContainers("2x40HC, 1x20RF")).toEqual([
      { q: 2, s: 40, t: "HC" },
      { q: 1, s: 20, t: "RF" },
    ]);
  });
  it("parses the × and 45ft variants and defaults a bare type", () => {
    expect(parseContainers("1×45DC")).toEqual([{ q: 1, s: 45, t: "DC" }]);
    expect(parseContainers("3x20")).toEqual([{ q: 3, s: 20, t: "DC" }]);
  });
});

describe("G16 — demurrage tiers by size AND type", () => {
  it("40HC uses the 40HC key (900/3600) not the plain 40 (600/2400)", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "HC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31", // 30 days port stay
      freeDays: 11,
    });
    const dem = out.rows.filter((r) => r.cat === "Demurrage");
    // Tier 1: days 12–21 = 10 days × 900 = 9000
    // Tier 2: days 22–30 = 9 days × 3600 = 32400
    expect(dem).toHaveLength(2);
    expect(dem[0]).toMatchObject({ qty: 10, unit: 900, total: 9000 });
    expect(dem[1]).toMatchObject({ qty: 9, unit: 3600, total: 32400 });
    expect(out.families.Demurrage).toBeCloseTo(41400);
  });

  it("plain 40 uses the 40 rate", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
    });
    const dem = out.rows.filter((r) => r.cat === "Demurrage");
    expect(dem[0].unit).toBe(600);
    expect(dem[1].unit).toBe(2400);
  });
});

describe("G16 — storage bands, yard, plugging, detention", () => {
  const base = {
    containers: [{ q: 1, s: 40, t: "DC" }],
    ata: "2026-01-01",
    gateOut: "2026-02-14", // 44 days port stay → storage bands 12-20(9),21-40(20),41-70(4)
    freeDays: 11,
  };

  it("storage uses the four absolute bands on the 40 rates", () => {
    const out = simulateCharges(base);
    const st = out.rows.filter((r) => r.cat === "Storage");
    expect(st).toHaveLength(3);
    expect(st[0]).toMatchObject({ desc: "12-20d", qty: 9, unit: 600, total: 5400 });
    expect(st[1]).toMatchObject({ desc: "21-40d", qty: 20, unit: 2400, total: 48000 });
    expect(st[2]).toMatchObject({ desc: "41-70d", qty: 4, unit: 7200, total: 28800 });
    expect(out.families.Storage).toBeCloseTo(82200);
  });

  it("yard occupancy is a one-off once port stay ≥ 14 days", () => {
    const out = simulateCharges(base);
    const yd = out.rows.filter((r) => r.cat === "Yard Occupancy");
    expect(yd).toHaveLength(1);
    expect(yd[0].qty).toBe(1);
    expect(yd[0].total).toBe(200000);
    // Under the trigger there is no yard charge.
    const short = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      freeDays: 11,
    });
    expect(short.rows.filter((r) => r.cat === "Yard Occupancy")).toHaveLength(0);
  });

  it("plugging is reefers only, ATA+1 → gate-out inclusive", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 20, t: "RF" }],
      ata: "2026-01-01",
      gateOut: "2026-01-05", // 5 days → plug days 01-02..01-05 = 4
      freeDays: 11,
    });
    const pl = out.rows.filter((r) => r.cat === "Plugging");
    expect(pl).toHaveLength(1);
    expect(pl[0]).toMatchObject({ qty: 4, unit: 13000, total: 52000 });
    // A dry container gets no plugging charge.
    const dry = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-05",
      freeDays: 11,
    });
    expect(dry.rows.filter((r) => r.cat === "Plugging")).toHaveLength(0);
  });

  it("detention is (empty-return − gate-out) − 2 free days, dry vs reefer", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      emptyReturn: "2026-01-20", // 10 days transit − 2 free = 8 chargeable
      freeDays: 11,
    });
    const det = out.rows.filter((r) => r.cat === "Detention");
    expect(det).toHaveLength(1);
    expect(det[0]).toMatchObject({ qty: 8, unit: 15000, total: 120000 });
  });
});

describe("G16 — VAT + totals", () => {
  it("applies 19.25% VAT on the HT total", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
    });
    expect(out.vat_rate).toBe(0.1925);
    expect(out.vat).toBeCloseTo(out.total_ht * 0.1925);
    expect(out.total_ttc).toBeCloseTo(out.total_ht + out.vat);
  });

  it("converts XAF to USD via the fx table (1 / rate)", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
      currency: "USD",
      fx: { XAF: 1, USD: 600 },
    });
    // Demurrage tier1: 10 × 300 = 3000 XAF → 5 USD
    const dem = out.rows.filter((r) => r.cat === "Demurrage");
    expect(dem[0].unit).toBe(0.5);
    expect(dem[0].total).toBe(5);
  });

  it("multiplies per-container quantities", () => {
    const one = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01", gateOut: "2026-01-31", freeDays: 11,
    });
    const two = simulateCharges({
      containers: [{ q: 2, s: 20, t: "DC" }],
      ata: "2026-01-01", gateOut: "2026-01-31", freeDays: 11,
    });
    expect(two.total_ht).toBeCloseTo(one.total_ht * 2);
  });

  it("exposes the legacy defaults for tenants that have not configured rates", () => {
    expect(DEFAULT_RATES.yardTrigger).toBe(14);
    expect(DEFAULT_RATES.detention.dry[40]).toBe(15000);
    expect(DEFAULT_RATES.storage[20]).toEqual([300, 1200, 3600, 6000]);
  });
});
