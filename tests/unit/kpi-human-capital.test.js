/**
 * Human Capital tiles (PR-4, guide §12 / D12) — the six flips and their
 * guard semantics.
 *
 * Every assertion in here is one of the four rules the band exists to enforce,
 * stated for this domain:
 *
 *   - ZERO VS NULL (§6.3): an empty-but-installed tenant answers 0 and the
 *     tile renders; a missing relation answers null and the tile is
 *     unavailable. The two are never allowed to swap.
 *   - MASKED ⇒ NO TILE (§4.3): `employee.salary` masked for the subject
 *     removes payroll_run_state from the band ENTIRELY — the assertion is an
 *     absence, never a zero, because "Payroll 0" from a salary-masked reader
 *     is a leak-shaped answer to a question they may not ask.
 *   - THE ATTENDANCE DENOMINATOR (§6.4): "0 clocked in" and "nobody was
 *     expected" arrive as different pairs, and the pair is weekend-, leave-
 *     and holiday-aware or the difference cannot be said at all.
 *   - EVENT-SOURCED ATTRITION: the count reads the employee.deactivated
 *     stream, not a status column, so a reactivation cannot rewrite the
 *     90-day window.
 *
 * No live database (same doctrine as kpi-band-endpoints.test.js): scripted
 * clients answer the guarded queries, and the SQL's own text is pinned where
 * the DEFINITION lives in the SQL — the weekend precedence, the leave
 * exclusion, the terminal payroll states — because those are product
 * decisions a green run must not silently drift from.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const catalog = require("../../src/modules/dashboard/kpi_catalog");
const { BY_ID, LIVE_IDS, valuesFor, checkValueCoverage } = catalog;
const { eligibleIds, resolveEligibility } = require("../../src/modules/dashboard/kpi_catalog/eligibility");
const { selectBand, paintBand } = require("../../src/modules/dashboard/kpi_catalog/resolve");
const humanCapital = require("../../src/modules/dashboard/kpi_catalog/human_capital");

const HC_IDS = [
  "headcount",
  "attendance_today",
  "leave_pending",
  "vacancies_open",
  "payroll_run_state",
  "attrition_90d",
];

/* ── scripted clients ─────────────────────────────────────────────────────── */

/** A client whose every business query fails — module off / relation absent. */
const deadClient = { query: () => Promise.reject(new Error("relation does not exist")) };

/**
 * A client with the relations but not the data: every aggregate answers its
 * empty-tenant truth. The attendance pair answers 0/0 — the Sunday shape.
 */
function emptyTenantClient({ attendance = { value: 0, denominator: 0 } } = {}) {
  return {
    query: (sql) => {
      const s = String(sql);
      if (/AS value/.test(s) && /AS denominator/.test(s)) {
        return Promise.resolve({ rows: [{ ...attendance }] });
      }
      return Promise.resolve({ rows: [{ n: 0 }] });
    },
  };
}

/** A client that records what the domain asked, answering empty aggregates. */
function capturingClient() {
  const captured = [];
  const client = {
    query: (sql) => {
      captured.push(String(sql));
      if (/AS value/.test(sql) && /AS denominator/.test(sql)) {
        return Promise.resolve({ rows: [{ value: 0, denominator: 0 }] });
      }
      return Promise.resolve({ rows: [{ n: 0 }] });
    },
  };
  return { captured, client };
}

/* ── the six flips ────────────────────────────────────────────────────────── */

describe("the six Human Capital tiles ship live (D12)", () => {
  it("every tile of the domain is live, and nothing else in it is", () => {
    const entries = humanCapital.ENTRIES;
    expect(entries.map((e) => e.id).sort()).toEqual([...HC_IDS].sort());
    for (const e of entries) expect(e.status).toBe("live");
  });

  it("the module keys gate what they always gated — changing one changes who sees the number", () => {
    expect(Object.fromEntries(humanCapital.ENTRIES.map((e) => [e.id, e.module]))).toEqual({
      headcount: "MOD-02",
      attendance_today: "MOD-14",
      leave_pending: "MOD-15",
      vacancies_open: "MOD-11",
      payroll_run_state: "MOD-17",
      attrition_90d: "MOD-02",
    });
  });

  it("values() answers every live id against a dead client — no key is left unwritten", async () => {
    // The PR-flip guard's own claim, asserted per domain: a guard that threw
    // before writing its key would make a LIVE tile silently unpaintable.
    const out = await humanCapital.values(deadClient, require("../../src/modules/dashboard/kpi_catalog/guards"));
    expect(Object.keys(out).sort()).toEqual([...HC_IDS].sort());
    for (const id of HC_IDS) expect(out[id]).toBeNull();
    await expect(checkValueCoverage()).resolves.toEqual([]);
  });

  it("the availability probe checks the relations the queries actually hit", () => {
    expect(Object.fromEntries(humanCapital.ENTRIES.map((e) => [e.id, e.sourceRelation]))).toEqual({
      headcount: "employee",
      attendance_today: "attendance_log",
      leave_pending: "leave_request",
      vacancies_open: "vacancy",
      payroll_run_state: "payroll_run",
      attrition_90d: "event_log",
    });
  });
});

/* ── zero vs null, per tile (§6.3) ────────────────────────────────────────── */

describe("guard semantics — the zero-vs-null split, one tile at a time", () => {
  const scalarIds = ["headcount", "leave_pending", "vacancies_open", "payroll_run_state", "attrition_90d"];

  it("an empty-but-installed tenant ASSERTS 0 for every count tile (D3)", async () => {
    const out = await valuesFor(emptyTenantClient(), HC_IDS);
    for (const id of scalarIds) {
      expect(out[id]).toBe(0); // a truth, not a gap
    }
  });

  it("a tenant whose HR relations are gone answers null — unavailable, never zero", async () => {
    const out = await valuesFor(deadClient, HC_IDS);
    for (const id of HC_IDS) expect(out[id]).toBeNull();
  });

  it.each(scalarIds)("%s: a resolved 0 paints, a null drops out and is counted", async (id) => {
    const selection = { source: "user", ids: [id] };
    const zero = paintBand(selection, { [id]: 0 });
    expect(zero.slots.map((s) => s.id)).toEqual([id]);
    expect(zero.slots[0].value).toBe(0);
    expect(zero.hidden).toEqual([]);
    const gone = paintBand(selection, { [id]: null });
    expect(gone.slots).toEqual([]);
    expect(gone.hidden).toEqual([id]);
  });

  it("each count query states its predicate — the definition, pinned", async () => {
    const { captured, client } = capturingClient();
    await valuesFor(client, HC_IDS);
    const sql = (re) => {
      const hit = captured.find((s) => re.test(s));
      expect(hit).toBeTruthy();
      return hit;
    };
    expect(sql(/FROM employee WHERE is_active/)).toBeTruthy(); // the active register
    expect(sql(/FROM leave_request WHERE status/)).toMatch(/status = 'REQUESTED'/);
    expect(sql(/FROM leave_request WHERE status/)).toMatch(/COALESCE\(kind, 'leave'\) <> 'salary_advance'/);
    expect(sql(/FROM vacancy WHERE status/)).toMatch(/status = 'OPEN'/);
    expect(sql(/FROM payroll_run WHERE status/)).toMatch(/status NOT IN \('DISBURSED','REJECTED'\)/);
    expect(sql(/FROM event_log WHERE event_type_key/)).toMatch(/event_type_key = 'employee\.deactivated'/);
    expect(sql(/FROM event_log WHERE event_type_key/)).toMatch(/interval '90 days'/);
  });
});

/* ── attendance: the pair and its denominator (§6.4) ─────────────────────── */

describe("attendance_today — clocked vs expected, as a pair", () => {
  it("resolves as { value, denominator } — never a bare count", async () => {
    const out = await valuesFor(emptyTenantClient({ attendance: { value: 18, denominator: 25 } }), [
      "attendance_today",
    ]);
    expect(out.attendance_today).toEqual({ value: 18, denominator: 25 });
  });

  it("'0 present' and 'nobody was expected' stay different statements", () => {
    const selection = { source: "user", ids: ["attendance_today"] };
    const everyoneAbsent = paintBand(selection, { attendance_today: { value: 0, denominator: 25 } });
    const nobodyExpected = paintBand(selection, { attendance_today: { value: 0, denominator: 0 } });
    expect(everyoneAbsent.slots[0]).toMatchObject({ value: 0, denominator: 25, measurable: true });
    expect(nobodyExpected.slots[0]).toMatchObject({ value: 0, denominator: 0, measurable: false });
  });

  it("a failed pair query is unavailable, not 0/0", async () => {
    const out = await valuesFor(deadClient, ["attendance_today"]);
    expect(out.attendance_today).toBeNull();
  });

  it("the expected set is weekend-, leave- and holiday-aware — the definition, pinned", async () => {
    const { captured, client } = capturingClient();
    await valuesFor(client, ["attendance_today"]);
    const sql = captured.find((s) => /AS denominator/.test(s));
    expect(sql).toBeTruthy();
    // The tenant's own clock, never the server's UTC date (the dayWindowSql
    // lesson: clock_in_at::date drops a 00:30 Douala punch onto yesterday).
    expect(sql).toMatch(/'hr' AND s\.key = 'timezone'/);
    expect(sql).toMatch(/'Africa\/Douala'/);
    expect(sql).not.toMatch(/clock_in_at::date/);
    // Employee work_days override FIRST, else the tenant weekend setting —
    // the reconciler's precedence (attendance.rules.isWorkingDay), and both
    // seeded shapes of hr.weekend_days parse, junk falling back to [0,6].
    expect(sql).toMatch(/cardinality\(e\.work_days\) > 0/);
    expect(sql).toMatch(/'hr' AND s\.key = 'weekend_days'/);
    expect(sql).toMatch(/ARRAY\[0,6\]::smallint\[\]/);
    // Approved or taken leave removes the day — reconcileDay lets leave beat
    // even a real punch, so an employee on holiday is in neither number.
    expect(sql).toMatch(/lr\.status IN \('APPROVED','TAKEN'\)/);
    // A public holiday is not an absence either.
    expect(sql).toMatch(/FROM public_holiday ph/);
    // And the clocked half counts PEOPLE who punched inside the local day
    // window, not punch rows.
    expect(sql).toMatch(/FROM attendance_log al/);
    expect(sql).toMatch(/count\(\*\) FROM expected/);
  });
});

/* ── payroll_run_state: masked ⇒ NO TILE (§4.3) ──────────────────────────── */

describe("payroll_run_state — the sensitive_field rule, applied uniformly", () => {
  const hrReadable = new Set(["MOD-02", "MOD-11", "MOD-14", "MOD-15", "MOD-17"]);

  it("declares employee.salary — the uniform rule needs the key on the entry", () => {
    expect(BY_ID.get("payroll_run_state").sensitive_field).toBe("employee.salary");
  });

  it("a subject with the grant and NO mask gets the tile", () => {
    expect(eligibleIds(hrReadable, new Set())).toContain("payroll_run_state");
  });

  it("a masked subject gets NO TILE — an absence, never a zeroed value", () => {
    const out = eligibleIds(hrReadable, new Set(["employee.salary"]));
    expect(out).not.toContain("payroll_run_state");
    // The falsifying case, stated the loud way: the tile is not in the band
    // at all, so no payroll number — aggregate or otherwise — reaches the
    // band for this subject.
    const band = paintBand(
      selectBand({ pins: ["payroll_run_state", "headcount"], roleConfigs: [], eligible: new Set(out) }),
      { headcount: 12, payroll_run_state: 3 },
    );
    expect(band.slots.map((s) => s.id)).toEqual(["headcount"]);
    expect(band.slots.some((s) => s.id === "payroll_run_state" && s.value === 0)).toBe(false);
  });

  it("the CEO bypass is grants-only: a salary mask set for the CEO still removes the tile", () => {
    const masked = new Set(["employee.salary"]);
    expect(eligibleIds(new Set(), masked, { isCeo: true })).not.toContain("payroll_run_state");
    expect(eligibleIds(new Set(), new Set(), { isCeo: true })).toContain("payroll_run_state");
  });

  it("resolveEligibility joins both halves — grants from one query, masks from the other", async () => {
    const client = {
      query: (sql) => {
        const s = String(sql);
        if (/FROM permission/.test(s)) {
          return Promise.resolve({ rows: [{ module_key: "MOD-17" }, { module_key: "MOD-02" }] });
        }
        if (/FROM field_visibility/.test(s)) {
          return Promise.resolve({ rows: [{ field_key: "employee.salary" }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };
    const out = await resolveEligibility(client, { roleIds: ["r1"], isCeo: false });
    expect(out.masked.has("employee.salary")).toBe(true);
    expect(out.liveIds).toContain("headcount"); // MOD-02, unmasked
    expect(out.liveIds).not.toContain("payroll_run_state"); // MOD-17, masked
  });
});

/* ── attrition: event-sourced on purpose ─────────────────────────────────── */

describe("attrition_90d — the event stream, not the status column", () => {
  it("counts employee.deactivated events in a rolling 90-day window", async () => {
    const { captured, client } = capturingClient();
    await valuesFor(client, ["attrition_90d"]);
    const sql = captured.find((s) => /FROM event_log/.test(s));
    expect(sql).toMatch(/event_type_key = 'employee\.deactivated'/);
    expect(sql).toMatch(/created_at >= now\(\) - interval '90 days'/);
    // And nothing reads employee.status — a status column IS a rewriteable
    // opinion; the append-only event_log (trg_eventlog_ro) is the record.
    expect(sql).not.toMatch(/employee\.status/);
    expect(sql).not.toMatch(/is_active/);
  });

  it("still answers 0 on a quiet tenant — 90 days without a departure is a fact", async () => {
    const out = await valuesFor(emptyTenantClient(), ["attrition_90d"]);
    expect(out.attrition_90d).toBe(0);
  });
});

/* ── the HR role seed (guide §12 — the seed example belongs to this PR) ───── */

describe("9024_seed_role_kpi_hr.sql — the HR curated row", () => {
  const seedPath = path.resolve(__dirname, "../../migrations/seeds/9024_seed_role_kpi_hr.sql");
  const sql = fs.readFileSync(seedPath, "utf8");

  it("exists as a NEW 90xx seed — 9023 is applied and keyed on filename, editing it would never re-run", () => {
    expect(fs.existsSync(seedPath)).toBe(true);
    expect(path.basename(seedPath)).toMatch(/^9024_/);
    // A NEW file, not an edit: 9023 must still be byte-identical to its
    // applied form (no HR row smuggled into it).
    const seed9023 = fs.readFileSync(
      path.resolve(__dirname, "../../migrations/seeds/9023_seed_role_kpi_defaults.sql"),
      "utf8",
    );
    expect(seed9023).not.toMatch(/'HR'/);
  });

  it("curates the guide §7.2 HR default: people operations first", () => {
    expect(sql).toMatch(/'HR',\s*ARRAY\['headcount','attendance_today','leave_pending','vacancies_open'\]/);
  });

  it("names only tiles that are LIVE, with the module the catalog declares — the seed cannot promise what the resolver would hide", () => {
    const tiles = [...sql.matchAll(/\('([a-z0-9_]+)',\s*'(MOD-[0-9A-Z]+)'\)/g)].map((m) => ({
      id: m[1],
      module: m[2],
    }));
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(LIVE_IDS).toContain(t.id);
      expect(BY_ID.get(t.id).module).toBe(t.module);
    }
  });

  it("keeps 9023's intersection property: defaults land only where the role can read the module", () => {
    expect(sql).toMatch(/JOIN eligible e ON e\.tile_id = q\.tile_id AND e\.role_id = r\.role_id/);
    expect(sql).toMatch(/p\.module_key = t\.module_key AND p\.can_read = true/);
  });

  it("is idempotent and reversible — the migration gates' contract, stated in the file", () => {
    expect(sql).toMatch(/ON CONFLICT \(role_id\) DO NOTHING/);
    expect(sql).toMatch(/^-- DOWN$/m);
    expect(sql).toMatch(/DELETE FROM role_kpi_config/);
  });

  it("locks nothing and narrows no scope — HR members arrange their own band", () => {
    expect(sql).toMatch(/NULL,\s*-- scope = dynamic/);
    expect(sql).toMatch(/'\{\}'/);
  });
});
