/**
 * Extra-charge / demurrage-detention simulator (MOD-28) — pure, NO GL.
 * Shipping lines bill per chargeable day beyond the free period, usually with a
 * rising tiered tariff (e.g. days 1-5 cheaper than 6-10, etc). This computes the
 * per-day breakdown from a tariff the tenant configures in settings.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

const round2 = (n) => Math.round(n * 100) / 100;
const MS_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates (to - from), min 0. */
function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new AppError("INVALID_DATE", "out_of_port_on / as_of must be YYYY-MM-DD", 422);
  return Math.max(0, Math.floor((b - a) / MS_DAY));
}

/**
 * computeDemurrage({ freeDays, occupiedDays, tiers }) where tiers is an ordered
 * list of { from_day, to_day|null, rate } (day numbers are 1-based, counted
 * AFTER the free period). Returns { chargeable_days, breakdown[], total_amount }.
 */
function computeDemurrage({ freeDays = 0, occupiedDays, tiers = [] }) {
  const free = Math.max(0, Math.floor(Number(freeDays) || 0));
  const occ = Math.floor(Number(occupiedDays));
  if (!Number.isFinite(occ) || occ < 0) throw new AppError("INVALID_DAYS", "occupiedDays must be >= 0", 422);
  if (!Array.isArray(tiers) || tiers.length === 0) throw new AppError("NO_TARIFF", "a demurrage tariff (tiers) is required", 422);

  const chargeable = Math.max(0, occ - free);
  const breakdown = [];
  let total = 0;
  for (let d = 1; d <= chargeable; d += 1) {
    const tier = tiers.find((t) => d >= Number(t.from_day) && (t.to_day === null || t.to_day === undefined || d <= Number(t.to_day)));
    if (!tier) throw new AppError("TARIFF_GAP", "no tariff tier covers chargeable day " + d, 422);
    const rate = round2(Number(tier.rate));
    total += rate;
    breakdown.push({ day: d, rate, tier_from: Number(tier.from_day), tier_to: tier.to_day === null || tier.to_day === undefined ? null : Number(tier.to_day) });
  }
  return { free_days: free, occupied_days: occ, chargeable_days: chargeable, breakdown, total_amount: round2(total) };
}

// ── G16: the full five-family simulator, ported from the legacy ─────────────
// `administration/view/admin/extra-charges-simulator.php` computed FIVE charge
// families per container; the rebuild shipped only demurrage. The port below
// mirrors the legacy rules exactly (the founder asked for it "copied as-is").

const VAT_RATE = 0.1925;

/**
 * The legacy defaults — `let STATE = {…}` at
 * `administration/view/admin/extra-charges-simulator.php:823-836`, transcribed
 * value for value. All five role copies of that page are byte-identical here.
 *
 * CORRECTED 10716. The previous table claimed to mirror the legacy and did not:
 * the STORAGE bands had been copied into the DEMURRAGE slot, so demurrage billed
 * 300/1200 (20') and 600/2400 (40') instead of 7092/12962.4 and 13465.2/25444.8
 * — roughly 23x under. `20RF` and `20FR` were [0, 0], so reefers and flat-racks
 * billed no demurrage at all, and `40RF`, `20HC` and `40FR` were missing
 * entirely and fell back to the (already wrong) plain-size rate. The unit suite
 * pinned the wrong numbers, so it stayed green throughout.
 *
 * These are defaults, not policy: a tenant's real tariff lives in settings
 * `commercial.extra_charge_rates` (seed 9093) and is merged over this table.
 * They matter anyway, because they are what an unconfigured tenant quotes.
 */
const DEFAULT_RATES = {
  yardTrigger: 14,
  // No live FX is hardcoded here. The legacy froze {USD:615, EUR:655.957} in a
  // JS literal and its "save" button only mutated an in-memory object
  // (`alert("Saved locally!")`), so those numbers were wrong the day after they
  // were typed. Real conversion rates come from the currency module
  // (master/currency — GET /currencies/rate, rateFor); the service resolves
  // them per request. Only the base anchor XAF→1 is a constant, not a rate.
  // scripts/check-currency-literals guards against re-introducing a literal.
  fx: { XAF: 1 },
  demurrage: {
    20: [7092, 12962.4],
    40: [13465.2, 25444.8],
    "20RF": [7092, 12962.4],
    "40RF": [13465.2, 25444.8],
    "20HC": [7092, 12962.4],
    "40HC": [13465.2, 25444.8],
    "20FR": [7092, 12962.4],
    "40FR": [13465.2, 25444.8],
  },
  storage: { 20: [300, 1200, 3600, 6000], 40: [600, 2400, 7200, 12000] },
  yard: { 20: 100000, 40: 200000 },
  detention: { dry: { 20: 7400, 40: 15000 }, rf: { 20: 37500, 40: 75000 } },
  plug: { 20: 13000, 40: 13000 },
};

/**
 * Normalise a free-text type fragment to a billing type code, the way the
 * legacy did it (`updateCalc`, ~:952): substring tests, not equality, so
 * "REEFER", "40RF", "HICUBE" and "FLATRACK" all land somewhere sensible, and
 * anything unrecognised bills as a dry box. RE is checked with RF because the
 * legacy accepted both spellings of reefer.
 */
function typeCode(raw) {
  const t = String(raw || "").toUpperCase();
  if (t.includes("RF") || t.includes("RE")) return "RF";
  if (t.includes("HC")) return "HC";
  if (t.includes("FR")) return "FR";
  return "DC";
}

/**
 * Parse a container list like the legacy did: `2x40HC, 1x20RF` →
 * [{ q, s, t }]. Sizes 20/40/45 are kept as written (sizeKey() collapses 45 to
 * the 40' band at billing time); the type is normalised to DC/RF/HC/FR.
 *
 * Legacy shape (`parseContainers`, :876): split on comma or semicolon, then one
 * match per part with quantity optional (`40HC` is one 40' high-cube) and the
 * separator being any of `*`, `x`, `X` or a space. A part that matches nothing
 * is skipped rather than raising — a half-typed list should show a partial
 * total, not an error dialog.
 *
 * BOUNDED QUANTIFIERS (CodeQL js/polynomial-redos). The legacy's `\d+\s*` on
 * user input can backtrack quadratically on a long digit run. Each repetition
 * here has a hard ceiling and the input is capped, so the worst case is linear.
 */
function parseContainers(text) {
  const out = [];
  const s = String(text || "").slice(0, 2000); // a container list is short
  const re = /^(?:(\d{1,6})\s{0,4}[*xX×\s]\s{0,4})?(20|40|45)(?:['"’]|ft|FT)?\s{0,4}([A-Za-z0-9]{0,12})/;
  for (const part of s.split(/[,;\n]/, 200)) {
    const p = part.trim();
    if (!p) continue;
    const m = re.exec(p);
    if (!m) continue;
    out.push({
      q: Math.max(1, parseInt(m[1], 10) || 1),
      s: parseInt(m[2], 10),
      t: typeCode(m[3]),
    });
  }
  return out;
}

/** 45' boxes bill on the 40' tariff — there is no 45 column in any rate table. */
const sizeKey = (s) => (Number(s) >= 40 ? 40 : 20);

/** The legacy demurrage rate key: size, or size+type for HC/RF/FR. */
function demurrageKey(c, rates) {
  const sk = sizeKey(c.s);
  const tc = typeCode(c.t);
  if (tc === "HC" || tc === "RF" || tc === "FR") {
    const k = `${sk}${tc}`;
    if (rates.demurrage && rates.demurrage[k]) return k;
  }
  return sk;
}

/**
 * The complete simulator. Inputs:
 *   containers  parsed [{q,s,t}] or a free-text string
 *   ata, gateOut, emptyReturn  ISO dates (emptyReturn/gateOut drive detention)
 *   freeDays    the free period (legacy default 11 → billing starts day 12)
 *   yardTrigger days of port stay that triggers the one-off yard charge
 *   rates       rate table (defaults to DEFAULT_RATES)
 *   fx          { XAF: 1, USD: x, EUR: y } — the legacy converted via 1/fx
 * Returns { rows, families, total_ht, vat, total_ttc, currency, per_container }.
 */
function simulateCharges({ containers = [], ata = null, gateOut = null, emptyReturn = null, freeDays = 0, yardTrigger = null, rates = null, fx = null, currency = "XAF" }) {
  const R = { ...DEFAULT_RATES, ...(rates || {}) };
  R.demurrage = { ...DEFAULT_RATES.demurrage, ...(rates && rates.demurrage) };
  R.storage = { ...DEFAULT_RATES.storage, ...(rates && rates.storage) };
  R.yard = { ...DEFAULT_RATES.yard, ...(rates && rates.yard) };
  R.detention = { ...DEFAULT_RATES.detention, ...(rates && rates.detention) };
  R.plug = { ...DEFAULT_RATES.plug, ...(rates && rates.plug) };
  const FX = { ...DEFAULT_RATES.fx, ...(rates && rates.fx), ...(fx || {}) };
  R.fx = FX;
  const trigger = yardTrigger ?? R.yardTrigger ?? 14;
  const free = Math.max(0, Math.floor(Number(freeDays) || 0));

  const dATA = ata ? Date.parse(ata) : NaN;
  const dGate = gateOut ? Date.parse(gateOut) : NaN;
  // The legacy defaulted an unset empty-return to the gate-out date, which makes
  // transit zero and detention zero — not "no detention section at all".
  const dRet = emptyReturn ? Date.parse(emptyReturn) : dGate;

  const ccy = FX[currency] || 1;
  const conv = (xaf) => Math.round((xaf / ccy) * 100) / 100;

  const rows = [];
  const families = {};

  const list = (Array.isArray(containers) ? containers : parseContainers(containers)).map((c) => ({
    q: Math.max(1, Math.floor(Number(c.q) || 1)),
    s: Number(c.s) || 20,
    t: typeCode(c.t),
  }));

  // Port stay is a property of the file, not of a container: same ATA, same
  // gate-out for every box on the bill of lading. Computed once.
  const portStay = Number.isFinite(dATA) && Number.isFinite(dGate)
    ? Math.max(0, Math.round((dGate - dATA) / MS_DAY))
    : 0;

  for (const c of list) {
    const sk = sizeKey(c.s);

    // 1. Demurrage — two tiers, per size AND type key (20/40/20RF/40HC/20FR).
    const dk = demurrageKey(c, R);
    const tier1 = R.demurrage[dk] || R.demurrage[sk] || [0, 0];
    const startBill = Math.max(12, free + 1);
    const d1 = Math.max(0, Math.min(portStay, 21) - startBill + 1);
    if (d1 > 0) {
      const rate = tier1[0] || 0;
      const amt = conv(d1 * rate * c.q);
      rows.push({ cat: "Demurrage", desc: `${c.s}' ${c.t} Tier 1 (${d1}d)`, qty: d1, unit: conv(rate), total: amt });
      families.Demurrage = (families.Demurrage || 0) + amt;
    }
    const startBill2 = Math.max(22, free + 1);
    const d2 = Math.max(0, portStay - startBill2 + 1);
    if (d2 > 0) {
      const rate = tier1[1] || 0;
      const amt = conv(d2 * rate * c.q);
      rows.push({ cat: "Demurrage", desc: `${c.s}' ${c.t} Tier 2 (${d2}d)`, qty: d2, unit: conv(rate), total: amt });
      families.Demurrage = (families.Demurrage || 0) + amt;
    }

    // 2. Storage — four absolute day bands: 12-20, 21-40, 41-70, 71+.
    const sRules = [[12, 20, 0], [21, 40, 1], [41, 70, 2], [71, 9999, 3]];
    for (const [lo, hi, idx] of sRules) {
      const sDays = Math.max(0, Math.min(portStay, hi) - lo + 1);
      if (sDays > 0) {
        const rate = (R.storage[sk] || [0, 0, 0, 0])[idx] || 0;
        const amt = conv(sDays * rate * c.q);
        rows.push({ cat: "Storage", desc: `${lo}-${hi}d`, qty: sDays, unit: conv(rate), total: amt });
        families.Storage = (families.Storage || 0) + amt;
      }
    }

    // 3. Yard occupancy — one-off per container once port stay ≥ trigger.
    if (portStay >= trigger) {
      const rate = R.yard[sk] || 0;
      const amt = conv(rate * c.q);
      rows.push({ cat: "Yard Occupancy", desc: `${c.s}' One-off`, qty: 1, unit: conv(rate), total: amt });
      families["Yard Occupancy"] = (families["Yard Occupancy"] || 0) + amt;
    }

    // 4. Plugging — reefers only, ATA+1 → gate-out inclusive.
    if (typeCode(c.t) === "RF" && Number.isFinite(dATA) && Number.isFinite(dGate)) {
      const startPlug = dATA + MS_DAY;
      let pDays = 0;
      if (dGate >= startPlug) pDays = Math.round((dGate - startPlug) / MS_DAY) + 1;
      if (pDays > 0) {
        const pRate = R.plug[sk] || 13000;
        const amt = conv(pDays * pRate * c.q);
        rows.push({ cat: "Plugging", desc: `${c.s}' RF (${pDays}d)`, qty: pDays, unit: conv(pRate), total: amt });
        families.Plugging = (families.Plugging || 0) + amt;
      }
    }

    // 5. Detention — (empty-return − gate-out) − 2 free days, dry vs reefer.
    if (Number.isFinite(dGate) && Number.isFinite(dRet)) {
      const trans = Math.max(0, Math.round((dRet - dGate) / MS_DAY));
      const detD = Math.max(0, trans - 2);
      if (detD > 0) {
        const detKey = typeCode(c.t) === "RF" ? "rf" : "dry";
        const rate = (R.detention[detKey] || {})[sk] || 0;
        const amt = conv(detD * rate * c.q);
        rows.push({ cat: "Detention", desc: `${c.s}' Return`, qty: detD, unit: conv(rate), total: amt });
        families.Detention = (families.Detention || 0) + amt;
      }
    }
  }

  const total_ht = round2(rows.reduce((a, r) => a + r.total, 0));
  const vat = round2(total_ht * VAT_RATE);

  // The legacy KPI strip: free days, port stay, and whether the free period was
  // blown. Due date is ATA + (free - 1) days, and the status compares gate-out
  // against it (`updateCalc`, :913-918) — EXCEEDED is strictly after.
  const due = Number.isFinite(dATA) ? dATA + (free - 1) * MS_DAY : NaN;
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);

  return {
    currency,
    rows,
    families: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, round2(v)])),
    total_ht,
    vat,
    total_ttc: round2(total_ht + vat),
    vat_rate: VAT_RATE,
    containers: list,
    // Metrics — what the screen puts above the table, computed server-side so
    // the client never re-derives a number the invoice will be argued over.
    free_days: free,
    port_stay_days: portStay,
    yard_trigger: trigger,
    due_date: iso(due),
    status: !Number.isFinite(dATA) || !Number.isFinite(dGate) ? "WAITING" : dGate > due ? "EXCEEDED" : "OK",
    container_count: list.reduce((a, c) => a + c.q, 0),
    teu: round2(list.reduce((a, c) => a + c.q * (sizeKey(c.s) === 40 ? 2 : 1), 0)),
    rates_used: R,
  };
}

module.exports = { daysBetween, computeDemurrage, parseContainers, simulateCharges, DEFAULT_RATES, VAT_RATE };
