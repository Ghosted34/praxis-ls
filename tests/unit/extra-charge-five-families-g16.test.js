"use strict";

/**
 * G16 — extra-charge simulator: five charge families, ported from the legacy
 * `administration/view/*\/extra-charges-simulator.php` the founder asked to be
 * "copied as-is".
 *
 * Demurrage (two tiers, per size+type), storage (four absolute day bands), yard
 * occupancy (one-off once port stay >= trigger), plugging (reefers, ATA+1 →
 * gate-out inclusive), detention ((empty-return − gate-out) − 2 free days, dry
 * vs reefer), with 19.25% VAT.
 *
 * WHY THIS FILE WAS REWRITTEN. Its previous version pinned the rates that were
 * actually in `DEFAULT_RATES` rather than the rates in the legacy, and those
 * two had diverged: the storage bands had been copied into the demurrage slot,
 * making demurrage ~23x too cheap, and `20RF`/`20FR` were [0, 0] so reefers
 * billed no demurrage at all. Twelve green tests certified the defect. Every
 * expected value below is now computed by hand from the legacy STATE block
 * (`extra-charges-simulator.php:823-836`) and its `updateCalc` (:894-1027),
 * with the arithmetic written out so a reviewer can check it without running
 * anything.
 */

const {
  parseContainers,
  simulateCharges,
  DEFAULT_RATES,
  VAT_RATE,
} = require("../../src/modules/commercial/extra_charge_simulation/extra_charge_simulation.rules");

// The legacy tariff, restated here independently of the source under test.
// If someone edits DEFAULT_RATES, these must fail.
const LEGACY = {
  demurrage20: [7092, 12962.4],
  demurrage40: [13465.2, 25444.8],
  storage20: [300, 1200, 3600, 6000],
  storage40: [600, 2400, 7200, 12000],
  yard: { 20: 100000, 40: 200000 },
  detention: { dry: { 20: 7400, 40: 15000 }, rf: { 20: 37500, 40: 75000 } },
  plug: 13000,
  yardTrigger: 14,
};

describe("G16 — the rate table is the legacy's", () => {
  it("demurrage is the demurrage tariff, not a copy of the storage bands", () => {
    expect(DEFAULT_RATES.demurrage[20]).toEqual(LEGACY.demurrage20);
    expect(DEFAULT_RATES.demurrage[40]).toEqual(LEGACY.demurrage40);
  });

  it("every size+type variant is present and bills the base size's rate", () => {
    for (const t of ["RF", "HC", "FR"]) {
      expect(DEFAULT_RATES.demurrage[`20${t}`]).toEqual(LEGACY.demurrage20);
      expect(DEFAULT_RATES.demurrage[`40${t}`]).toEqual(LEGACY.demurrage40);
    }
  });

  it("storage, yard, detention, plugging and the trigger match", () => {
    expect(DEFAULT_RATES.storage[20]).toEqual(LEGACY.storage20);
    expect(DEFAULT_RATES.storage[40]).toEqual(LEGACY.storage40);
    expect(DEFAULT_RATES.yard).toEqual(LEGACY.yard);
    expect(DEFAULT_RATES.detention).toEqual(LEGACY.detention);
    expect(DEFAULT_RATES.plug).toEqual({ 20: LEGACY.plug, 40: LEGACY.plug });
    expect(DEFAULT_RATES.yardTrigger).toBe(LEGACY.yardTrigger);
    expect(VAT_RATE).toBe(0.1925);
  });

  it("no reefer or flat-rack bills zero demurrage", () => {
    for (const [k, v] of Object.entries(DEFAULT_RATES.demurrage)) {
      expect(`${k}:${v[0]}`).not.toBe(`${k}:0`);
      expect(`${k}:${v[1]}`).not.toBe(`${k}:0`);
    }
  });
});

describe("G16 — parseContainers (legacy free-text list)", () => {
  it("parses 2x40HC, 1x20RF", () => {
    expect(parseContainers("2x40HC, 1x20RF")).toEqual([
      { q: 2, s: 40, t: "HC" },
      { q: 1, s: 20, t: "RF" },
    ]);
  });

  it("parses the × and 45ft variants and defaults a bare type to DC", () => {
    expect(parseContainers("1×45DC")).toEqual([{ q: 1, s: 45, t: "DC" }]);
    expect(parseContainers("3x20")).toEqual([{ q: 3, s: 20, t: "DC" }]);
    expect(parseContainers("2 x 40ft")).toEqual([{ q: 2, s: 40, t: "DC" }]);
  });

  it("defaults a missing quantity to 1, as the legacy regex did", () => {
    expect(parseContainers("40HC")).toEqual([{ q: 1, s: 40, t: "HC" }]);
  });

  it("normalises types by substring, exactly as the legacy did", () => {
    expect(parseContainers("1x40REEFER")[0].t).toBe("RF"); // contains "RE"
    expect(parseContainers("1x40HCPW")[0].t).toBe("HC"); // contains "HC"
    expect(parseContainers("1x20FR")[0].t).toBe("FR");
    expect(parseContainers("1x20GP")[0].t).toBe("DC"); // unrecognised → dry
    // Faithfully inherited quirk: the legacy matched SUBSTRINGS, so a type it
    // cannot see its own code inside falls through to dry — "FLATRACK" holds no
    // "FR" and "HICUBE" holds no "HC". Pinned, not fixed: changing it would
    // silently reprice files the legacy has already quoted.
    expect(parseContainers("1x20FLATRACK")[0].t).toBe("DC");
    expect(parseContainers("1x40HICUBE")[0].t).toBe("DC");
  });

  it("skips unparseable parts instead of throwing", () => {
    expect(parseContainers("2x40HC, , rubbish, 1x20")).toEqual([
      { q: 2, s: 40, t: "HC" },
      { q: 1, s: 20, t: "DC" },
    ]);
    expect(parseContainers("")).toEqual([]);
    expect(parseContainers(null)).toEqual([]);
  });
});

describe("G16 — demurrage: two tiers on absolute port-stay days", () => {
  // 1x40HC, ATA 2026-01-01, gate-out 2026-01-31 → portStay = 30, free = 11.
  //   startBill  = max(12, 12) = 12 → tier 1 = min(30,21) - 12 + 1 = 10 days
  //   startBill2 = max(22, 12) = 22 → tier 2 = 30 - 22 + 1        =  9 days
  const out = simulateCharges({
    containers: [{ q: 1, s: 40, t: "HC" }],
    ata: "2026-01-01",
    gateOut: "2026-01-31",
    freeDays: 11,
  });
  const dem = out.rows.filter((r) => r.cat === "Demurrage");

  it("bills 10 days at tier 1 and 9 at tier 2", () => {
    expect(dem).toHaveLength(2);
    expect(dem[0].qty).toBe(10);
    expect(dem[1].qty).toBe(9);
  });

  it("40HC uses the 40' tariff — 13465.2 then 25444.8", () => {
    expect(dem[0].unit).toBe(13465.2);
    expect(dem[1].unit).toBe(25444.8);
    expect(dem[0].total).toBeCloseTo(10 * 13465.2, 2); // 134,652
    expect(dem[1].total).toBeCloseTo(9 * 25444.8, 2); // 229,003.20
    expect(out.families.Demurrage).toBeCloseTo(363655.2, 2);
  });

  it("a reefer bills the same demurrage as its dry equivalent, not zero", () => {
    const rf = simulateCharges({
      containers: [{ q: 1, s: 20, t: "RF" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
    });
    const d = rf.rows.filter((r) => r.cat === "Demurrage");
    expect(d[0].unit).toBe(7092);
    expect(d[1].unit).toBe(12962.4);
    expect(rf.families.Demurrage).toBeCloseTo(10 * 7092 + 9 * 12962.4, 2); // 187,581.60
  });

  it("a longer free period pushes tier 1 out but never tier 2 before day 22", () => {
    // free = 19 → startBill = 20 → tier 1 = min(30,21) - 20 + 1 = 2 days
    const late = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 19,
    });
    const d = late.rows.filter((r) => r.cat === "Demurrage");
    expect(d[0].qty).toBe(2);
    expect(d[1].qty).toBe(9);
  });

  it("nothing is billed inside the free period", () => {
    const clean = simulateCharges({
      containers: [{ q: 3, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10", // 9 days, free 11
      freeDays: 11,
    });
    expect(clean.rows.filter((r) => r.cat === "Demurrage")).toHaveLength(0);
    expect(clean.total_ht).toBe(0);
    expect(clean.status).toBe("OK");
  });

  it("quantity multiplies the line", () => {
    const two = simulateCharges({
      containers: [{ q: 2, s: 40, t: "HC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
    });
    expect(two.families.Demurrage).toBeCloseTo(2 * 363655.2, 2);
  });
});

describe("G16 — storage: four absolute day bands", () => {
  // 1x20, portStay 45 → 12-20 = 9d @300, 21-40 = 20d @1200, 41-70 = 5d @3600
  const out = simulateCharges({
    containers: [{ q: 1, s: 20, t: "DC" }],
    ata: "2026-01-01",
    gateOut: "2026-02-15",
    freeDays: 11,
  });
  const st = out.rows.filter((r) => r.cat === "Storage");

  it("spans exactly the bands the port stay reaches", () => {
    expect(st.map((r) => [r.desc, r.qty])).toEqual([
      ["12-20d", 9],
      ["21-40d", 20],
      ["41-70d", 5],
    ]);
  });

  it("bills each band at its own rate", () => {
    expect(out.families.Storage).toBeCloseTo(9 * 300 + 20 * 1200 + 5 * 3600, 2); // 44,700
  });

  it("the bands are absolute — the free period does not shift them", () => {
    const zeroFree = simulateCharges({
      containers: [{ q: 1, s: 20, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-02-15",
      freeDays: 0,
    });
    expect(zeroFree.families.Storage).toBeCloseTo(out.families.Storage, 2);
  });
});

describe("G16 — yard occupancy: a one-off at the trigger", () => {
  const at = (days, trigger) =>
    simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: new Date(Date.UTC(2026, 0, 1 + days)).toISOString().slice(0, 10),
      freeDays: 11,
      yardTrigger: trigger,
    });

  it("does not fire below the trigger and fires at it", () => {
    expect(at(13, 14).rows.some((r) => r.cat === "Yard Occupancy")).toBe(false);
    expect(at(14, 14).rows.some((r) => r.cat === "Yard Occupancy")).toBe(true);
  });

  it("is charged once per container, not per day", () => {
    const long = simulateCharges({
      containers: [{ q: 3, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-03-01", // 59 days
      freeDays: 11,
    });
    const yard = long.rows.filter((r) => r.cat === "Yard Occupancy");
    expect(yard).toHaveLength(1);
    expect(yard[0].qty).toBe(1);
    expect(yard[0].total).toBe(3 * 200000);
  });
});

describe("G16 — plugging: reefers only, ATA+1 to gate-out inclusive", () => {
  it("bills 10 days for a reefer landed on the 1st and collected on the 11th", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "RF" }],
      ata: "2026-01-01",
      gateOut: "2026-01-11",
      freeDays: 11,
    });
    const plug = out.rows.filter((r) => r.cat === "Plugging");
    expect(plug).toHaveLength(1);
    expect(plug[0].qty).toBe(10); // (11 Jan − 2 Jan) + 1
    expect(plug[0].unit).toBe(13000);
    expect(plug[0].total).toBe(130000);
  });

  it("does not bill a dry box, a high-cube or a flat-rack", () => {
    for (const t of ["DC", "HC", "FR"]) {
      const out = simulateCharges({
        containers: [{ q: 1, s: 40, t }],
        ata: "2026-01-01",
        gateOut: "2026-01-11",
        freeDays: 11,
      });
      expect(out.rows.some((r) => r.cat === "Plugging")).toBe(false);
    }
  });

  it("bills nothing when the box leaves the day it lands", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 20, t: "RF" }],
      ata: "2026-01-01",
      gateOut: "2026-01-01",
      freeDays: 11,
    });
    expect(out.rows.some((r) => r.cat === "Plugging")).toBe(false);
  });
});

describe("G16 — detention: transit beyond two free days", () => {
  it("bills (empty-return − gate-out) − 2 at the dry rate", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      emptyReturn: "2026-01-20", // 10 days transit → 8 chargeable
      freeDays: 11,
    });
    const det = out.rows.filter((r) => r.cat === "Detention");
    expect(det[0].qty).toBe(8);
    expect(det[0].unit).toBe(15000);
    expect(det[0].total).toBe(120000);
  });

  it("uses the reefer rate for a reefer", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 20, t: "RF" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      emptyReturn: "2026-01-20",
      freeDays: 11,
    });
    const det = out.rows.filter((r) => r.cat === "Detention");
    expect(det[0].unit).toBe(37500);
    expect(det[0].total).toBe(8 * 37500);
  });

  it("bills nothing for a return inside the two free days", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      emptyReturn: "2026-01-12",
      freeDays: 11,
    });
    expect(out.rows.some((r) => r.cat === "Detention")).toBe(false);
  });

  it("treats a missing empty-return as returned on gate-out, so zero", () => {
    const out = simulateCharges({
      containers: [{ q: 1, s: 40, t: "DC" }],
      ata: "2026-01-01",
      gateOut: "2026-01-10",
      freeDays: 11,
    });
    expect(out.rows.some((r) => r.cat === "Detention")).toBe(false);
  });
});

describe("G16 — totals, VAT and currency", () => {
  const base = {
    containers: "2x40HC, 1x20RF",
    ata: "2026-01-01",
    gateOut: "2026-01-31",
    emptyReturn: "2026-02-10",
    freeDays: 11,
  };

  it("HT is the sum of the rows and TTC carries 19.25% VAT", () => {
    const out = simulateCharges(base);
    const sum = out.rows.reduce((a, r) => a + r.total, 0);
    expect(out.total_ht).toBeCloseTo(sum, 2);
    expect(out.vat).toBeCloseTo(out.total_ht * 0.1925, 2);
    expect(out.total_ttc).toBeCloseTo(out.total_ht * 1.1925, 2);
    expect(out.vat_rate).toBe(0.1925);
  });

  it("family totals reconcile to HT", () => {
    const out = simulateCharges(base);
    const byFamily = Object.values(out.families).reduce((a, v) => a + v, 0);
    expect(byFamily).toBeCloseTo(out.total_ht, 1);
  });

  it("all five families appear for a mixed reefer/dry file", () => {
    const out = simulateCharges(base);
    expect(new Set(out.rows.map((r) => r.cat))).toEqual(
      new Set([
        "Demurrage",
        "Storage",
        "Yard Occupancy",
        "Plugging",
        "Detention",
      ]),
    );
  });

  it("converts to USD by dividing the XAF total by the rate", () => {
    const xaf = simulateCharges(base);
    const usd = simulateCharges({ ...base, currency: "USD" });
    expect(usd.currency).toBe("USD");
    expect(usd.total_ht).toBeCloseTo(xaf.total_ht / 615, 0);
  });

  it("honours a per-request FX override", () => {
    const out = simulateCharges({ ...base, currency: "USD", fx: { USD: 600 } });
    const xaf = simulateCharges(base);
    expect(out.total_ht).toBeCloseTo(xaf.total_ht / 600, 0);
  });

  it("an unknown currency falls back to 1:1 rather than NaN", () => {
    const out = simulateCharges({ ...base, currency: "GBP" });
    expect(Number.isFinite(out.total_ht)).toBe(true);
    expect(out.total_ht).toBeCloseTo(simulateCharges(base).total_ht, 2);
  });

  it("a tenant tariff overrides only the keys it supplies", () => {
    const out = simulateCharges({
      ...base,
      rates: { demurrage: { 40: [1, 2] } },
    });
    const dem = out.rows.filter((r) => r.cat === "Demurrage");
    // 40HC still resolves via its own key, which was not overridden.
    expect(dem.some((r) => r.unit === 13465.2)).toBe(true);
    // Storage was untouched, so the legacy bands still apply.
    expect(out.rows.filter((r) => r.cat === "Storage")[0].unit).toBe(600);
  });
});

describe("G16 — the metrics the screen shows above the table", () => {
  it("reports port stay, free days, due date and an EXCEEDED status", () => {
    const out = simulateCharges({
      containers: "2x40HC, 1x20RF",
      ata: "2026-01-01",
      gateOut: "2026-01-31",
      freeDays: 11,
    });
    expect(out.port_stay_days).toBe(30);
    expect(out.free_days).toBe(11);
    expect(out.due_date).toBe("2026-01-11"); // ATA + (free − 1)
    expect(out.status).toBe("EXCEEDED");
    expect(out.container_count).toBe(3);
    expect(out.teu).toBe(5); // 2 x 40' = 4 TEU, 1 x 20' = 1
  });

  it("is OK when the box leaves on the due date and WAITING without dates", () => {
    const ok = simulateCharges({
      containers: "1x20",
      ata: "2026-01-01",
      gateOut: "2026-01-11",
      freeDays: 11,
    });
    expect(ok.status).toBe("OK");
    expect(simulateCharges({ containers: "1x20" }).status).toBe("WAITING");
  });

  it("returns the tariff it used, for the snapshot the row stores", () => {
    const out = simulateCharges({
      containers: "1x20",
      ata: "2026-01-01",
      gateOut: "2026-01-31",
    });
    expect(out.rates_used.demurrage[20]).toEqual(LEGACY.demurrage20);
    expect(out.rates_used.yardTrigger).toBe(14);
  });
});
