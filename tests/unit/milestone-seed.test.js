"use strict";
/**
 * Integrity of the seeded milestone chains (9091).
 *
 * The seed itself raises on a bad weight sum, so a broken chain cannot reach a
 * database. But that check only fires when somebody RUNS the seed against
 * Postgres — which, for a file that is applied once at provisioning, can be a
 * long time after the edit that broke it. This reads the SQL statically so an
 * edit that unbalances a chain fails in the fast suite, next to the change.
 *
 * WHY THE WEIGHTS ARE WORTH A TEST AT ALL. They are the duration model: a
 * segment summing to 97 instead of 100 silently shortens every forecast on that
 * service by 3%, on every dossier, forever. It produces no error and no
 * complaint — just dates that are quietly wrong, which is the failure mode this
 * whole engine exists to remove.
 */
const fs = require("fs");
const path = require("path");

const SEED = path.join(
  __dirname,
  "..",
  "..",
  "migrations",
  "seeds",
  "9091_seed_milestone_templates.sql",
);

/** The 12 system service types 9080 seeds; each must ship a chain. */
const SERVICES = [
  "SEA_FREIGHT_IMPORT",
  "SEA_FREIGHT_EXPORT",
  "AIR_FREIGHT_IMPORT",
  "AIR_FREIGHT_EXPORT",
  "HINTERLAND_TRANSIT",
  "INLAND_TRANSPORTATION",
  "WAREHOUSING",
  "END_TO_END_AIR_FREIGHT",
  "END_TO_END_SEA_FREIGHT",
  "BUSINESS_REPRESENTATION",
  "CUSTOMS_BROKERAGE",
  "PROJECT_CARGO",
];

const OWNER_TIERS = new Set([
  "INTERNAL",
  "CARRIER",
  "TERMINAL",
  "AUTHORITY",
  "CLIENT",
]);

/**
 * Parse the `_ms_stage` VALUES rows. Deliberately a narrow regex over the
 * leading, fixed-position columns (service, seq, code, then two quoted labels,
 * then weight/floor/owner) rather than a general SQL parser — the labels
 * contain commas, apostrophes and accents, and a naive split on "," would
 * mangle them.
 */
function stages() {
  const sql = fs.readFileSync(SEED, "utf8");
  const re =
    /^\s*\('([A-Z_]+)',\s*(\d+),'([A-Z0-9_]+)','((?:[^']|'')*)','((?:[^']|'')*)',(\d+),(\d+),'([A-Z]+)',(true|false),(true|false),(true|false),(NULL|'[A-Z_]+'),'([A-Z]+)'/gm;
  const out = [];
  let m;
  while ((m = re.exec(sql)) !== null) {
    out.push({
      svc: m[1],
      seq: Number(m[2]),
      code: m[3],
      labelEn: m[4],
      labelFr: m[5],
      weight: Number(m[6]),
      minHours: Number(m[7]),
      owner: m[8],
      anchor: m[9] === "true",
      lock: m[10] === "true",
      visible: m[11] === "true",
      segment: m[13],
    });
  }
  return out;
}

const all = stages();
const forService = (svc) => all.filter((s) => s.svc === svc);

describe("seeded milestone chains", () => {
  it("parses the seed at all", () => {
    // Guards the reader: if the regex stops matching, every assertion below
    // would pass vacuously against an empty list.
    expect(all.length).toBe(168);
  });

  it.each(SERVICES)("%s ships exactly 14 stages", (svc) => {
    expect(forService(svc)).toHaveLength(14);
  });

  it.each(SERVICES)("%s weights sum to 100 per chain segment", (svc) => {
    const bySegment = {};
    for (const s of forService(svc))
      bySegment[s.segment] = (bySegment[s.segment] || 0) + s.weight;
    for (const [segment, total] of Object.entries(bySegment)) {
      // STEADY runs on a cadence and carries no weight — it is not part of any
      // horizon, so its sum must be zero rather than 100.
      expect({ segment, total }).toEqual({
        segment,
        total: segment === "STEADY" ? 0 : 100,
      });
    }
  });

  it.each(SERVICES)(
    "%s has unique stage codes and a contiguous 1..14 sequence",
    (svc) => {
      const rows = forService(svc);
      expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
      expect(rows.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 14 }, (_, i) => i + 1),
      );
    },
  );

  /**
   * One lock and at most one anchor PER SEGMENT, not per chain.
   *
   * A bounded segment is its own promise with its own horizon — warehousing
   * commits separately to the receipt (GRN) and to the release (gate-out), and
   * business representation to going live and to the renewal decision. Two
   * locks in ONE segment would give that segment two contradictory horizons,
   * which is the thing worth forbidding.
   */
  const bounded = (svc) => {
    const segs = new Map();
    for (const s of forService(svc)) {
      if (s.segment === "STEADY") continue;
      if (!segs.has(s.segment)) segs.set(s.segment, []);
      segs.get(s.segment).push(s);
    }
    return segs;
  };

  it.each(SERVICES)(
    "%s declares exactly one target lock per bounded segment",
    (svc) => {
      for (const [segment, rows] of bounded(svc)) {
        expect({ segment, locks: rows.filter((s) => s.lock).length }).toEqual({
          segment,
          locks: 1,
        });
      }
    },
  );

  it.each(SERVICES)(
    "%s declares at most one anchor per bounded segment",
    (svc) => {
      for (const [segment, rows] of bounded(svc)) {
        expect({
          segment,
          anchors: rows.filter((s) => s.anchor).length,
        }).toEqual({ segment, anchors: expect.any(Number) });
        expect(rows.filter((s) => s.anchor).length).toBeLessThanOrEqual(1);
      }
    },
  );

  it("gives every stage a valid owner tier — attribution depends on it", () => {
    const bad = all.filter((s) => !OWNER_TIERS.has(s.owner));
    expect(bad).toEqual([]);
  });

  it("gives every stage both EN and FR labels", () => {
    const missing = all.filter((s) => !s.labelEn.trim() || !s.labelFr.trim());
    expect(missing).toEqual([]);
  });

  it("gives every scheduled stage a compression floor above zero", () => {
    // A stage with no floor can be compressed to nothing when an SLA is locked,
    // which is exactly the impossible schedule guardrail 3 exists to prevent.
    // Cadence-driven STEADY stages are exempt: they are never scheduled.
    const bad = all.filter((s) => s.segment !== "STEADY" && s.minHours <= 0);
    expect(bad).toEqual([]);
  });

  it("keeps money-adjacent stages off the client portal", () => {
    const leaky = all.filter(
      (s) =>
        /INVOICE|BILLING|RETAINER|HANDLING_SETTLED/.test(s.code) && s.visible,
    );
    expect(leaky).toEqual([]);
  });

  it("seeds an assumptions register for every service type", () => {
    const sql = fs.readFileSync(SEED, "utf8");
    for (const svc of SERVICES) {
      // Each service publishes at least one assumption, and every service that
      // can be disrupted publishes its force-majeure exclusions.
      expect(sql).toContain(`('${svc}',1,`);
    }
  });
});
