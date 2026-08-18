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

/** The legacy defaults (STATE in the PHP, lines ~825-835). A tenant overrides
 *  via settings; these are the values the client has been quoted against. */
const DEFAULT_RATES = {
  yardTrigger: 14,
  demurrage: { 20: [300, 1200], 40: [600, 2400], "20RF": [0, 0], "40HC": [900, 3600], "20FR": [0, 0] },
  storage: { 20: [300, 1200, 3600, 6000], 40: [600, 2400, 7200, 12000] },
  yard: { 20: 100000, 40: 200000 },
  detention: { dry: { 20: 7400, 40: 15000 }, rf: { 20: 37500, 40: 75000 } },
  plug: { 20: 13000, 40: 13000 },
};

/**
 * Parse a container list like the legacy did: `2x40HC, 1x20RF` →
 * [{ q, s, t }]. Sizes 20/40/45 collapse to the billing sizeKey (20 or 40);
 * the type code is DC/RF/HC/FR. Anything unparseable is dropped, not fatal —
 * same tolerance as the legacy regex.
 */
function parseContainers(text) {
  const out = [];
  // q x size type — the type is optional (`3x20` is three 20' DC).
  const re = /(\d+)\s*[xX×]\s*(\d{2})?\s*(?:([A-Za-z]{2,3}))?/g;
  let m;
  const s = String(text || "");
  while ((m = re.exec(s)) !== null) {
    if (!m[1] && !m[2] && !m[3]) continue;
    const q = Math.max(1, parseInt(m[1], 10) || 1);
    const sRaw = parseInt(m[2], 10) || 20;
    const t = (m[3] || "DC").toUpperCase();
    out.push({ q, s: sRaw, t });
  }
  return out;
}

const sizeKey = (s) => (Number(s) >= 40 ? 40 : 20);

/** The legacy demurrage rate key: size, or size+type for HC/RF/FR. */
function demurrageKey(c, rates) {
  const sk = sizeKey(c.s);
  if (c.t === "HC" || c.t === "RF" || c.t === "FR") {
    const k = `${sk}${c.t}`;
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
  const trigger = yardTrigger ?? R.yardTrigger ?? 14;
  const free = Math.max(0, Math.floor(Number(freeDays) || 0));

  const dATA = ata ? Date.parse(ata) : NaN;
  const dGate = gateOut ? Date.parse(gateOut) : NaN;
  const dRet = emptyReturn ? Date.parse(emptyReturn) : NaN;

  const ccy = fx && fx[currency] ? fx[currency] : 1;
  const conv = (xaf) => Math.round((xaf / ccy) * 100) / 100;

  const rows = [];
  const families = {};

  const list = Array.isArray(containers) ? containers : parseContainers(containers);
  for (const c of list) {
    const sk = sizeKey(c.s);
    const portStay = Number.isFinite(dATA) && Number.isFinite(dGate)
      ? Math.max(0, Math.round((dGate - dATA) / MS_DAY))
      : 0;

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
    if (c.t === "RF" && Number.isFinite(dATA) && Number.isFinite(dGate)) {
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
        const detKey = c.t === "RF" ? "rf" : "dry";
        const rate = (R.detention[detKey] || {})[sk] || 0;
        const amt = conv(detD * rate * c.q);
        rows.push({ cat: "Detention", desc: `${c.s}' Return`, qty: detD, unit: conv(rate), total: amt });
        families.Detention = (families.Detention || 0) + amt;
      }
    }
  }

  const total_ht = round2(rows.reduce((a, r) => a + r.total, 0));
  const vat = round2(total_ht * VAT_RATE);
  return {
    currency,
    rows,
    families: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, round2(v)])),
    total_ht,
    vat,
    total_ttc: round2(total_ht + vat),
    vat_rate: VAT_RATE,
    containers: list,
  };
}

module.exports = { daysBetween, computeDemurrage, parseContainers, simulateCharges, DEFAULT_RATES, VAT_RATE };
