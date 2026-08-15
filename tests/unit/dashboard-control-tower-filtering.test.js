/**
 * The Control Tower query: filters, counts, pagination, and the two derivations
 * the map's honesty depends on.
 *
 * ── WHY THIS ASSERTS ON SQL AND NOT ON ROWS ─────────────────────────────────
 *
 * Unlike the place search — where the ranking ladder is the product behaviour and
 * the rows are what anybody would notice — the questions here are about the
 * QUERY: does a filter reach the database at all, is the same predicate applied to
 * the count and to the page, and is a value from the URL bound rather than
 * interpolated. Those are decidable from the statement, and a fake that returned
 * plausible rows would pass while the filter was silently dropped — which is
 * exactly the F-16 failure mode the API audit describes ("unknown filters are
 * silently ignored; a consumer with a typo gets wrong data and no signal").
 *
 * The row-shaped behaviour is covered where it belongs: the projection in
 * `itinerary-validation.test.js`, the client derivations in `model.test.ts`.
 */
"use strict";

const repo = require("../../src/modules/dashboard/dashboard/dashboard.repo");

/**
 * Records every statement and answers each with a plausible shape. Deliberately
 * permissive on unknown SQL — this repo's own `rows()` helper swallows query
 * errors by design (a missing table degrades to an empty value rather than
 * breaking the whole dashboard), so a throwing fake would test the fake.
 */
function fakeClient({ shipments = [], counts = {} } = {}) {
  const state = { sql: [], params: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      state.params.push(params);
      if (/COUNT\(\*\) FILTER \(WHERE d.status/i.test(s)) {
        return {
          rows: [
            {
              active: 3,
              open: 2,
              in_progress: 1,
              movement: 2,
              activity: 1,
              needs_location: 1,
              ...counts,
            },
          ],
        };
      }
      if (/FROM approval_task/i.test(s)) return { rows: [{ awaiting: 4 }] };
      if (/FROM dossier_visible d/i.test(s)) return { rows: shipments };
      return { rows: [] };
    },
  };
}

/** The page query — the one that returns the rows the map draws. */
const pageSql = (c) =>
  c.state.sql.find(
    (s) =>
      /FROM dossier_visible d/i.test(s) &&
      /ORDER BY d.created_at DESC/i.test(s),
  );
/** The count query, which must carry the SAME predicate as the page. */
const countSql = (c) =>
  c.state.sql.find((s) => /COUNT\(\*\) FILTER \(WHERE d.status/i.test(s));

const row = (over = {}) => ({
  dossier_id: "d-1",
  created_at: "2026-08-01T00:00:00.000Z",
  ref: "SBX-OPS-1",
  status: "OPEN",
  origin: "Shanghai",
  destination: "Douala",
  service_key: "SEA_FREIGHT_IMPORT",
  service_name: "Sea freight import",
  mode: "SEA",
  is_movement: true,
  needs_location: false,
  origin_lat: "31.229200",
  origin_lng: "121.474400",
  origin_name: "Shanghai",
  origin_verified_at: "2026-01-01T00:00:00.000Z",
  dest_lat: "4.048200",
  dest_lng: "9.700400",
  dest_name: "Douala",
  dest_verified_at: "2026-01-01T00:00:00.000Z",
  milestone_total: 9,
  milestone_done: 5,
  milestone_blocked: 0,
  milestone_overdue: 0,
  current_milestone: "Costing approval",
  ...over,
});

describe("the default view", () => {
  test("shows only active files — a completed file is history, not operations", async () => {
    const c = fakeClient();
    await repo.controlTower(c);
    expect(pageSql(c)).toContain("d.status IN ('OPEN','IN_PROGRESS')");
  });

  test("includes completed ones when explicitly asked", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { includeCompleted: true });
    expect(pageSql(c)).not.toContain("d.status IN ('OPEN','IN_PROGRESS')");
  });

  test("reads the DRAFT-free view, never the base table", async () => {
    // A draft is half-finished wizard state, not a file. The tower enumerates.
    const c = fakeClient();
    await repo.controlTower(c);
    expect(pageSql(c)).toContain("FROM dossier_visible");
    expect(pageSql(c)).not.toMatch(/FROM dossier\s/);
  });
});

describe("filters reach the database", () => {
  test("every filter value is BOUND, never interpolated", async () => {
    const c = fakeClient();
    await repo.controlTower(c, {
      serviceTypeId: "st-1",
      territory: "CM'; DROP TABLE dossier; --",
      mode: "SEA",
      from: "2026-01-01",
      to: "2026-12-31",
    });
    const sql = pageSql(c);
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).toContain("st.territory = $");
    // The hostile string travels as a parameter value, which is inert.
    expect(
      c.state.params.some((p) => p.includes("CM'; DROP TABLE dossier; --")),
    ).toBe(true);
  });

  test("the mode filter uses the ITINERARY, not the service-type name", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { mode: "SEA" });
    const sql = pageSql(c);
    // The key heuristic had to put PROJECT_CARGO somewhere and chose the road
    // corridors, so a file whose main carriage is a chartered vessel was filtered,
    // coloured and counted as a truck. The leg knows; the key is the fallback.
    expect(sql).toContain("FROM dossier_itinerary_leg l");
    expect(sql).toContain("l.leg_type = 'MAIN_CARRIAGE'");
    expect(sql).not.toContain("'%PROJECT%'");
  });

  test("the layer filter partitions movement from facility work", async () => {
    const movement = fakeClient();
    await repo.controlTower(movement, { layer: "MOVEMENT" });
    expect(pageSql(movement)).toMatch(
      /d\.pol IS NOT NULL OR d\.pod IS NOT NULL/,
    );

    const activity = fakeClient();
    await repo.controlTower(activity, { layer: "ACTIVITY" });
    expect(pageSql(activity)).toMatch(/NOT \(/);
  });

  test("the unverified filter IS the location-needed queue", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { verified: "UNVERIFIED" });
    const sql = pageSql(c);
    // Two states make a plotted route a guess: no reference at all (legacy free
    // text) and a reference nobody confirmed (the background-geocode population).
    expect(sql).toContain("d.pol_place_id IS NULL OR gp_o.verified_at IS NULL");
    expect(sql).toContain("d.pod_place_id IS NULL OR gp_d.verified_at IS NULL");
  });

  test("the verified filter is its exact complement", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { verified: "VERIFIED" });
    expect(pageSql(c)).toMatch(/NOT \(\s*\(d\.pol IS NOT NULL/);
  });

  test("each date field maps to its own column", async () => {
    for (const [field, column] of [
      ["created", "d.created_at"],
      ["updated", "d.updated_at"],
      ["arrival", "d.eta"],
      ["delivery", "d.promised_delivery_date"],
    ]) {
      const c = fakeClient();
      await repo.controlTower(c, { dateField: field, from: "2026-01-01" });
      expect(pageSql(c)).toContain(`${column} >= $`);
    }
  });

  test("an unknown date field falls back to created rather than breaking", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { dateField: "whenever", from: "2026-01-01" });
    expect(pageSql(c)).toContain("d.created_at >= $");
  });

  test("the `to` bound includes the whole day", async () => {
    // A date-only upper bound compared with `<=` excludes everything that happened
    // on the day itself, which reads as "my file vanished".
    const c = fakeClient();
    await repo.controlTower(c, { to: "2026-12-31" });
    expect(pageSql(c)).toContain("::date + INTERVAL '1 day'");
  });
});

describe("the counts describe the same set as the list", () => {
  test("the count query carries every predicate the page does", async () => {
    const c = fakeClient();
    await repo.controlTower(c, {
      mode: "AIR",
      territory: "CM",
      verified: "UNVERIFIED",
      layer: "MOVEMENT",
    });
    const page = pageSql(c);
    const count = countSql(c);
    for (const fragment of [
      "st.territory = $",
      "l.leg_type = 'MAIN_CARRIAGE'",
      "verified_at IS NULL",
      "d.pol IS NOT NULL",
    ]) {
      expect(page).toContain(fragment);
      // The class of bug this prevents: a header that says 12 above a list of 3.
      expect(count).toContain(fragment);
    }
  });

  test("the queue count is over the whole filtered set, not the visible page", async () => {
    // A count derived from 50 visible rows would say "2 need a location" on page
    // one of eleven, which is worse than saying nothing.
    const c = fakeClient({ counts: { needs_location: 17 } });
    const out = await repo.controlTower(c, { limit: 1 });
    expect(out.operation_files.needs_location).toBe(17);
  });

  test("movement and activity are reported separately", async () => {
    const c = fakeClient({ counts: { movement: 9, activity: 4 } });
    const out = await repo.controlTower(c);
    expect(out.operation_files).toMatchObject({ movement: 9, activity: 4 });
  });
});

describe("pagination", () => {
  test("asks for one more row than the page, to know whether there is a next", async () => {
    const c = fakeClient({ shipments: [row(), row({ dossier_id: "d-2" })] });
    const out = await repo.controlTower(c, { limit: 1 });
    expect(out.page.has_more).toBe(true);
    expect(out.live_shipments).toHaveLength(1);
  });

  test("the cursor is the last row's (created_at, id) — stable under inserts", async () => {
    const c = fakeClient({ shipments: [row(), row({ dossier_id: "d-2" })] });
    const out = await repo.controlTower(c, { limit: 1 });
    expect(out.page.next_cursor).toBe("2026-08-01T00:00:00.000Z.d-1");
  });

  test("no next cursor on the last page", async () => {
    const c = fakeClient({ shipments: [row()] });
    const out = await repo.controlTower(c, { limit: 50 });
    expect(out.page.has_more).toBe(false);
    expect(out.page.next_cursor).toBeNull();
  });

  test("a cursor is applied as a row-value comparison, both parts bound", async () => {
    const c = fakeClient();
    await repo.controlTower(c, { cursor: "2026-08-01T00:00:00.000Z.d-1" });
    expect(pageSql(c)).toContain("(d.created_at, d.dossier_id) < ($");
  });

  test("a malformed cursor is ignored rather than 500ing the dashboard", async () => {
    const c = fakeClient();
    await expect(
      repo.controlTower(c, { cursor: "garbage" }),
    ).resolves.toBeTruthy();
    expect(pageSql(c)).not.toContain("(d.created_at, d.dossier_id) <");
  });

  test("the limit is clamped — a client asking for 10,000 rows gets the maximum", async () => {
    const c = fakeClient();
    const out = await repo.controlTower(c, { limit: 10_000 });
    expect(out.page.limit).toBe(100);
  });

  test("a nonsense limit falls back to the default", async () => {
    const c = fakeClient();
    expect((await repo.controlTower(c, { limit: "abc" })).page.limit).toBe(50);
  });
});

describe("the rows the map draws", () => {
  test("coordinates are numbers and carry their verification state", async () => {
    const c = fakeClient({ shipments: [row()] });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.coords.from).toMatchObject({
      latitude: 31.2292,
      longitude: 121.4744,
      state: "verified",
    });
    expect(typeof s.coords.to.latitude).toBe("number");
  });

  test("a reference point says so, so the map can draw it hollow", async () => {
    const c = fakeClient({
      shipments: [row({ dest_is_reference_point: true })],
    });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.coords.to.state).toBe("reference");
  });

  test("an unconfirmed coordinate is unverified, not verified", async () => {
    const c = fakeClient({ shipments: [row({ dest_verified_at: null })] });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.coords.to.state).toBe("unverified");
  });

  test("one end unresolved yields NO lane — half a route is a fabrication", async () => {
    const c = fakeClient({
      shipments: [row({ dest_lat: null, dest_lng: null })],
    });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.coords).toBeNull();
  });

  test("progress is null when a file has no milestone chain", async () => {
    // "Not tracked" and "not started" are different facts; a 0%-width bar asserts
    // the second one.
    const c = fakeClient({
      shipments: [row({ milestone_total: 0, milestone_done: 0 })],
    });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.progress).toBeNull();
  });

  test("the dossier id travels, because that is what selection and links key on", async () => {
    const c = fakeClient({ shipments: [row()] });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s.dossier_id).toBe("d-1");
  });

  test("the mode and the movement flag come from the server, not from a guess", async () => {
    const c = fakeClient({
      shipments: [row({ mode: "LAND", is_movement: false })],
    });
    const [s] = (await repo.controlTower(c)).live_shipments;
    expect(s).toMatchObject({ mode: "LAND", is_movement: false });
  });

  test("an empty result is an empty list, not an error", async () => {
    const c = fakeClient({ shipments: [] });
    const out = await repo.controlTower(c);
    expect(out.live_shipments).toEqual([]);
    expect(out.page.has_more).toBe(false);
  });
});
