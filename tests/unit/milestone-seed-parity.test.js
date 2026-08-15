/**
 * `0680` republishes the shipped milestone chain for the three service types the
 * sandbox got to first, and it does that by carrying a COPY of 9091's stage rows.
 *
 * A copy is a drift risk, and this is the thing that makes it a caught one: both
 * files are read, both stage catalogues are parsed, and the three service types
 * they share must agree on every column. Re-weight a stage in 9091 and forget
 * 0680, and this fails by name.
 *
 * WHY A COPY AT ALL. A migration cannot include another file, 9091's temp table is
 * gone by the time 0680 runs, and on the tenants that need 0680 the rows were never
 * inserted — so there is nothing in the database to read them back from either.
 * Duplicating 42 rows and pinning them with a test is the least-bad of the three.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const SEED = path.join(root, "migrations", "seeds", "9091_seed_milestone_templates.sql");
const REPUBLISH = path.join(root, "migrations", "tenant", "0680_publish_shipped_milestone_chain.sql");

/** The three the sandbox seeds a demo chain for, and therefore the three 0680 carries. */
const SHARED = ["SEA_FREIGHT_IMPORT", "AIR_FREIGHT_IMPORT", "HINTERLAND_TRANSIT"];

/**
 * Pull the stage tuples out of a migration.
 *
 * Deliberately a dumb line scanner rather than a SQL parser: both files write one
 * stage per line in the same column order, and a change that breaks this scanner
 * is a change big enough to want a human to look at both files anyway.
 *
 * BOUNDED TO ONE INSERT BLOCK, and that bound is load-bearing. 9091 also carries a
 * service-duration list and an assumptions register whose rows have the very same
 * `('SERVICE_KEY', n, ...)` shape — an unbounded scan pulled seven of them in per
 * service type and compared apples to oranges. Reading only between the INSERT and
 * its terminating semicolon is exact.
 */
function stageRows(file, marker, services) {
  const wanted = new Set(services);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const starts = lines.reduce((acc, l, i) => (l.includes(marker) ? [...acc, i] : acc), []);
  if (!starts.length) throw new Error(`${path.basename(file)}: no "${marker}" — the scanner is out of date`);

  const out = [];
  // EVERY block, not just the first: 9091 writes one INSERT per service type, so a
  // scan that stopped at the first semicolon read the sea chain and reported the
  // other two as empty — which is a parity check that passes by comparing nothing.
  for (const start of starts) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line) {
        const row = line.replace(/[,;]\s*$/, "");
        if (/^\('[A-Z_]+',\s*\d+,/.test(row)) {
          const svc = row.slice(2, row.indexOf("'", 2));
          if (wanted.has(svc)) out.push({ svc, line: row });
        }
      }
      if (line.endsWith(";")) break;
    }
  }
  return out;
}

const SEED_MARKER = "INSERT INTO _ms_stage (";
const REPUBLISH_MARKER = "INSERT INTO _ms14 (";

describe("0680 carries 9091's stages unchanged", () => {
  const seed = stageRows(SEED, SEED_MARKER, SHARED);
  const republish = stageRows(REPUBLISH, REPUBLISH_MARKER, SHARED);

  test("both files parse — a scanner that finds nothing must not pass silently", () => {
    // The failure this prevents: a formatting change makes the regex match zero
    // lines, `[] === []`, and the parity check goes green having compared nothing.
    expect(seed.length).toBe(42);
    expect(republish.length).toBe(42);
  });

  test.each(SHARED)("%s has the same 14 stages in both files", (svc) => {
    const a = seed.filter((r) => r.svc === svc).map((r) => r.line);
    const b = republish.filter((r) => r.svc === svc).map((r) => r.line);
    expect(a).toHaveLength(14);
    expect(b).toEqual(a);
  });

  test("0680 carries the three sandbox service types and no others", () => {
    // Widening it would mean replacing a chain some tenant authored, which is the
    // destruction 9091 was careful to avoid.
    const all = stageRows(REPUBLISH, REPUBLISH_MARKER, [
      ...SHARED,
      "SEA_FREIGHT_EXPORT", "AIR_FREIGHT_EXPORT", "INLAND_TRANSPORTATION",
      "WAREHOUSING", "CUSTOMS_BROKERAGE", "BUSINESS_REPRESENTATION",
      "END_TO_END_SEA_FREIGHT", "END_TO_END_AIR_FREIGHT", "PROJECT_CARGO",
    ]);
    expect([...new Set(all.map((r) => r.svc))].sort()).toEqual([...SHARED].sort());
  });
});

describe("the sandbox signature 0680 matches on", () => {
  const sandbox = fs.readFileSync(path.join(root, "scripts", "tenant", "seed-sandbox.sql"), "utf8");
  const republish = fs.readFileSync(REPUBLISH, "utf8");

  /**
   * 0680 replaces a chain only when its stage codes are EXACTLY the sandbox's
   * five. If the sandbox ever changes its demo chain, the signature stops matching
   * and 0680 silently does nothing — which is safe, but is also silent. This is
   * what makes it loud.
   */
  test.each([
    ["v_mt,", ["ARRIVAL", "BOOKING", "CUSTOMS", "DELIVERY", "DEPARTURE"]],
    ["v_mt_air,", ["ARRIVAL", "BOOKING", "CUSTOMS", "DELIVERY", "DEPARTURE"]],
    ["v_mt_transit,", ["ARRIVAL", "BORDER", "DISCHARGE", "ESCORT", "T1_LODGED"]],
  ])("%s still has the codes the migration looks for", (marker, expected) => {
    const codes = sandbox
      .split("\n")
      .filter((l) => l.trim().startsWith(`(${marker}`))
      .map((l) => {
        const m = /^\([a-z_]+,\d+,'([A-Z0-9_]+)'/.exec(l.trim());
        return m && m[1];
      })
      .filter(Boolean)
      .sort();
    expect(codes).toEqual(expected);
    // …and the migration is looking for exactly that array.
    expect(republish).toContain(`ARRAY['${expected.join("','")}']`);
  });

  test("the demo chain is five stages, which is why it is recognisable", () => {
    // If the sandbox grew its chain to fourteen this migration would be pointless,
    // and leaving it in place would be confusing rather than harmful.
    const lines = sandbox.split("\n").filter((l) => /^\s*\(v_mt(_air|_transit)?,\d+,'/.test(l));
    expect(lines).toHaveLength(15);
  });
});
