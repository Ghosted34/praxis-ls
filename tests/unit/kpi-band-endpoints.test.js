/**
 * The band's endpoints, INVOKED — not the route table, the handlers.
 *
 * Same doctrine as `attendance-endpoints.test.js`: a test that never calls a
 * handler cannot catch the class of bug that ships (a name that does not
 * resolve, a precedence applied in the wrong order, a null painted as zero or
 * a zero hidden as if it were a null). Two fake clients mirror the two real
 * handles the request runs against — identity (grants, pins, role config) and
 * business (relations, values) — so the D5 doctrine ("identity half resolves
 * on the live schema, values on the mode's") is exercised by the very
 * plumbing, not asserted beside it.
 *
 * THE SCENARIOS ARE THE POLICY:
 *   - an empty LIVE tenant renders its picked zeros, and only a
 *     relation-missing tile goes to `hidden` (the fix for the "live shows
 *     less than test" report — same band, honest numbers, in both modes);
 *   - pins the subject cannot read drop out, counted;
 *   - the role editor refuses what the role cannot read, and a revocation
 *     prunes what it no longer names.
 */
"use strict";

const { LIVE_IDS, BY_ID } = require("../../src/modules/dashboard/kpi_catalog");

jest.mock("../../src/config/redis", () => ({ getClient: () => null }));

const controller = require("../../src/modules/dashboard/dashboard/dashboard.controller");
const roleKpiService = require("../../src/modules/security/role_kpi/role_kpi.service");
const permissionService = require("../../src/modules/security/permission/permission.service");

/* ── fakes ─────────────────────────────────────────────────────────────────── */

/** Identity-schema fake: user_preference rows, permission grants,
 *  field_visibility masks, role_kpi_config rows, the role lookup. */
function identityFake({ grants = [], masks = [], pins, roleConfig, role = { role_id: "r1", code: "FINANCE" }, captured = {} } = {}) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      captured.sql = captured.sql || [];
      captured.sql.push({ s, params });
      if (/FROM user_preference/.test(s)) {
        return { rows: pins === null || pins === undefined ? [] : [{ key: "kpi_pins", value: pins }] };
      }
      if (/FROM permission WHERE role_id = ANY/.test(s)) {
        const wanted = params[1] || [];
        return { rows: grants.filter((g) => wanted.includes(g)).map((module_key) => ({ module_key })) };
      }
      if (/FROM field_visibility/.test(s)) {
        return { rows: masks.map((field_key) => ({ field_key })) };
      }
      if (/FROM role WHERE role_id/.test(s)) return { rows: role ? [role] : [] };
      if (/FROM role_kpi_config k/.test(s)) {
        if (!roleConfig) return { rows: [] };
        return { rows: [{ ...roleConfig, role_code: role && role.code, role_name: "Finance" }] };
      }
      if (/DELETE FROM role_kpi_config/.test(s)) {
        captured.deleted = params[0];
        return { rows: [], rowCount: 1 };
      }
      if (/FROM role_kpi_config WHERE role_id/.test(s)) {
        return { rows: roleConfig ? [{ role_id: role.role_id, ...roleConfig }] : [] };
      }
      if (/INSERT INTO role_kpi_config/.test(s)) {
        captured.upsert = { scope: params[1], defaults: params[2], locked: params[3] };
        return { rows: [{ role_id: params[0], scope_ids: params[1], default_ids: params[2], locked_ids: params[3] }] };
      }
      if (/UPDATE role_kpi_config/.test(s)) {
        captured.update = { scope: params[1], defaults: params[2], locked: params[3] };
        return { rows: [{ role_id: params[0], scope_ids: params[1], default_ids: params[2], locked_ids: params[3] }] };
      }
      // audit/event inserts land on this fake too — lenient by construction.
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Business-schema fake: the regclass probe and the guarded tile queries. */
function businessFake({ missing = [], captured = {} } = {}) {
  const has = (rel) => !missing.includes(rel);
  const relOf = (s) =>
    [/FROM invoice\b/.test(s) && "invoice", /FROM journal_entry/.test(s) && "journal_entry",
     /FROM dossier_visible/.test(s) && "dossier_visible", /FROM approval_task/.test(s) && "approval_task",
     /FROM compliance_flag/.test(s) && "compliance_flag", /FROM vehicle\b/.test(s) && "vehicle"]
      .filter(Boolean)[0];
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      captured.sql = captured.sql || [];
      captured.sql.push({ s, params });
      if (/to_regclass/.test(s)) {
        const out = {};
        params.forEach((rel, i) => {
          out[`r${i}`] = has(rel);
        });
        return { rows: [out] };
      }
      const rel = relOf(s);
      if (rel && !has(rel)) throw new Error(`relation "${rel}" does not exist`);
      if (/SUM\(total_ttc\)/.test(s)) return { rows: [{ n: 0 }] }; // asserted zero
      if (/FILTER \(WHERE ata <= eta\)/.test(s)) return { rows: [{ value: 0, denominator: 0 }] };
      if (/FILTER \(WHERE status='ACTIVE'\)/.test(s)) return { rows: [{ value: 0, denominator: 0 }] };
      if (/count\(\*\) n/.test(s)) return { rows: [{ n: 0 }] };
      if (/payment_due_on/.test(s) || /FROM invoice/.test(s)) return { rows: [] };
      return { rows: [{ n: 0 }] };
    },
  };
}

function call(handler, { user, identity, business }) {
  return new Promise((resolve, reject) => {
    const req = {
      user,
      identityDb: (fn) => fn(identity),
      tenantDb: (fn) => fn(business),
    };
    const res = { json: (body) => resolve(body) };
    handler(req, res, reject);
  });
}

const USER = { user_id: "u1", role_ids: ["r1"], is_ceo: false };
const allGrants = [...new Set(LIVE_IDS.map((id) => BY_ID.get(id).module))];

/* ── GET /dashboard/kpis ─────────────────────────────────────────────────── */

describe("GET /dashboard/kpis — legacy keys + the resolved band", () => {
  it("a fresh tenant's default band ASSERTS zeros — the four the guide says are honest (D3, §6.3)", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER, // no role config row → system default four
      identity: identityFake({ grants: allGrants }),
      business: businessFake(),
    });
    expect(data.band.source).toBe("default");
    expect(data.band.slots.map((s) => s.id)).toEqual([
      "revenue",
      "receivables_overdue",
      "sla_on_time",
      "fleet_utilisation",
    ]);
    // Every slot has a NUMBER — including 0 — and the ratio tiles carry the
    // measurable flag that separates "0 % over nothing" from "0 % everything
    // late" without inventing a third card state (§6.4).
    for (const slot of data.band.slots) expect(typeof slot.value).toBe("number");
    const sla = data.band.slots.find((s) => s.id === "sla_on_time");
    expect(sla).toMatchObject({ unit: "pct", value: 0, denominator: 0, measurable: false });
  });

  it("a module with NO RELATION in this schema makes its tile hidden — not zero (the LIVE/TEST fix)", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER,
      identity: identityFake({ grants: allGrants }),
      business: businessFake({ missing: ["vehicle"] }),
    });
    expect(data.band.slots.map((s) => s.id)).not.toContain("fleet_utilisation");
    expect(data.band.hidden).toContain("fleet_utilisation");
    // …while the zeros the old code ALSO hid (SLA, empty fleet) now stay,
    // because their relations exist and their answer is genuinely 0.
    expect(data.band.slots.some((s) => s.value === 0)).toBe(true);
  });

  it("the user's own pins win, in their order (D1)", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER,
      identity: identityFake({
        grants: allGrants,
        pins: ["files_active", "compliance_open", "needs_location"],
      }),
      business: businessFake(),
    });
    expect(data.band.source).toBe("user");
    expect(data.band.slots.map((s) => s.id)).toEqual(["files_active", "compliance_open", "needs_location"]);
  });

  it("a pinned tile whose grant was revoked drops to `hidden` — and the pins are not rewritten (shrink, §6.2)", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER,
      identity: identityFake({
        grants: allGrants.filter((m) => m !== "MOD-65"), // compliance read revoked
        pins: ["files_active", "compliance_open"],
      }),
      business: businessFake(),
    });
    expect(data.band.slots.map((s) => s.id)).toEqual(["files_active"]);
    expect(data.band.hidden).toEqual(["compliance_open"]);
  });

  it("role defaults paint members who never opened the picker; locks lead the band", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER, // pins null
      identity: identityFake({
        grants: allGrants,
        roleConfig: { scope_ids: null, default_ids: ["revenue", "compliance_open", "files_active"], locked_ids: ["revenue"] },
      }),
      business: businessFake(),
    });
    expect(data.band.source).toBe("role");
    expect(data.band.slots.map((s) => s.id)).toContain("revenue");
    expect(data.band.slots[0].id).toBe("revenue"); // locked leads
  });

  it("legacy keys ride along unchanged for the drills still built on them", async () => {
    const { data } = await call(controller.kpisWithBand, {
      user: USER,
      identity: identityFake({ grants: allGrants }),
      business: businessFake(),
    });
    expect(data).toHaveProperty("revenue_final_ttc");
    expect(data).toHaveProperty("sla_on_time_pct");
    expect(data.band.currency).toBe("XAF");
  });

  it("the identity half reads user_preference, permission and role_kpi_config — the business half reads only data", async () => {
    const ident = identityFake({ grants: allGrants, captured: (global.__capI = {}) });
    const biz = businessFake({ captured: (global.__capB = {}) });
    await call(controller.kpisWithBand, { user: USER, identity: ident, business: biz });
    const iSql = global.__capI.sql.map((q) => q.s).join("\n");
    const bSql = global.__capB.sql.map((q) => q.s).join("\n");
    expect(iSql).toMatch(/FROM user_preference/);
    expect(iSql).toMatch(/FROM permission WHERE role_id = ANY/);
    expect(iSql).toMatch(/role_kpi_config/);
    // The business schema never sees a grants or preferences query — that is
    // D5 ("one choice, both modes") enforced by plumbing: a TEST session
    // could otherwise read SANDBOXED pins, a different band per mode.
    expect(bSql).not.toMatch(/user_preference|FROM permission|role_kpi_config/);
  });
});

/* ── GET /dashboard/kpi-catalog ──────────────────────────────────────────── */

describe("GET /dashboard/kpi-catalog", () => {
  it("offers exactly what this subject can see, what their role scoped, and what this mode can paint", async () => {
    const { data } = await call(controller.kpiCatalog, {
      user: USER,
      identity: identityFake({
        grants: ["MOD-00A", "MOD-29", "MOD-65"], // eligible: files, sla, late_vs_eta (PR-2), needs_loc, approvals, compliance
        pins: ["files_active"],
        roleConfig: { scope_ids: ["files_active", "compliance_open"], default_ids: ["compliance_open"], locked_ids: [] },
      }),
      business: businessFake({ missing: ["compliance_flag"] }),
    });
    // scope drops approvals/needs_location from OFFER; the missing relation
    // drops compliance — so the only tile listed is files_active, and what
    // fell out is counted, not enumerated (the withheld reason is not shown).
    expect(data.tiles.map((tile) => tile.id)).toEqual(["files_active"]);
    // 6 eligible − 1 offered: sla/late_vs_eta/approvals/needs_loc out of scope, compliance off-mode.
    // (The count grows by one every time a domain PR flips a MOD-29/00A/65 tile live.)
    expect(data.hiddenTileCount).toBe(5);
    expect(data.lockedIds).toEqual([]);
    expect(data.currentIds).toEqual(["files_active"]);
    expect(data.maxTiles).toBe(4);
    expect(data.source).toBe("user");
  });

  it("scope narrows the member's choices, not the band's defaults (defaults bypass scope at read)", async () => {
    const { data } = await call(controller.kpiCatalog, {
      user: USER,
      identity: identityFake({
        grants: allGrants,
        pins: ["files_active", "receivables_overdue"], // one outside the scope
        roleConfig: { scope_ids: ["files_active"], default_ids: ["receivables_overdue"], locked_ids: [] },
      }),
      business: businessFake(),
    });
    expect(data.currentIds).toEqual(["files_active"]); // out-of-scope pin not shown as chosen
    expect(data.roleDefaultIds).toEqual(["receivables_overdue"]); // the default still names it
  });
});

/* ── PUT /roles/:id/kpi — validation is the feature ──────────────────────── */

describe("role KPI config writes", () => {
  it("accepts a valid config and audits it", async () => {
    const captured = {};
    const fake = identityFake({
      grants: ["MOD-51", "MOD-52", "MOD-50", "MOD-55"],
      role: { role_id: "r1", code: "FINANCE" },
      captured,
    });
    const out = await roleKpiService.put(fake, {
      roleId: "r1",
      config: { scopeIds: null, defaultIds: ["revenue", "receivables_overdue"], lockedIds: ["revenue"] },
      actor: { user_id: "u9", email: "admin@t" },
    });
    expect(out.default_ids).toEqual(["revenue", "receivables_overdue"]);
    expect(captured.upsert).toBeTruthy();
    expect(captured.sql.map((q) => q.s).join("\n")).toMatch(/immutable_ledger/i);
  });

  it("rejects a default naming a tile that is not live yet, naming the release gate (hidden entries are inert)", async () => {
    // `cash_collected` is PR-3's, still hidden — and its module (MOD-52) IS in
    // allGrants, so the failure is the live gate, not the read gate.
    const fake = identityFake({ grants: allGrants });
    await expect(
      roleKpiService.put(fake, {
        roleId: "r1",
        config: { scopeIds: null, defaultIds: ["cash_collected"], lockedIds: [] },
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "KPI_NOT_LIVE", status: 422 });
  });

  it("rejects a scope the role cannot read, naming the grant it would need (matrix-before-band)", async () => {
    const fake = identityFake({ grants: ["MOD-51"] }); // FINANCE can read MOD-51 only
    await expect(
      roleKpiService.put(fake, {
        roleId: "r1",
        config: { scopeIds: ["compliance_open"], defaultIds: [], lockedIds: [] },
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "KPI_NOT_READABLE", status: 422, message: expect.stringContaining("MOD-65") });
  });

  it("rejects a default outside the narrowed scope (the DB CHECK, pre-empted with a message)", async () => {
    const fake = identityFake({ grants: allGrants });
    await expect(
      roleKpiService.put(fake, {
        roleId: "r1",
        config: { scopeIds: ["files_active"], defaultIds: ["revenue"], lockedIds: [] },
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "DEFAULT_OUT_OF_SCOPE" });
  });

  it("CEO may configure what the matrix cannot: the bypass applies to their own band, not to the role being edited", async () => {
    const fake = identityFake({
      grants: [],
      role: { role_id: "r9", code: "CEO" },
    });
    const out = await roleKpiService.put(fake, {
      roleId: "r9",
      config: { scopeIds: null, defaultIds: ["revenue"], lockedIds: [] },
      actor: {},
    });
    expect(out.default_ids).toEqual(["revenue"]);
  });

  it("config:null clears the row and audits the removal", async () => {
    const captured = {};
    const fake = identityFake({
      grants: allGrants,
      roleConfig: { scope_ids: null, default_ids: ["revenue"], locked_ids: [] },
      captured,
    });
    const out = await roleKpiService.put(fake, { roleId: "r1", config: null, actor: {} });
    expect(out).toBeNull();
    expect(captured.deleted).toBe("r1");
  });
});

/* ── the revocation prune ────────────────────────────────────────────────── */

describe("pruneUnreadable — revoking a module retires its tiles from the row", () => {
  it("drops the defaulted and locked tiles whose grants died; keeps the rest", async () => {
    const captured = {};
    const fake = identityFake({
      grants: ["MOD-51"], // compliance (MOD-65) revoked since the row was written
      role: { role_id: "r1", code: "FINANCE" },
      roleConfig: { scope_ids: null, default_ids: ["revenue", "compliance_open"], locked_ids: ["revenue"] },
      captured,
    });
    const out = await roleKpiService.pruneUnreadable(fake, "r1");
    expect(out).toEqual({ cleared: false, removed: ["compliance_open"] });
    expect(captured.update.defaults).toEqual(["revenue"]);
    expect(captured.update.locked).toEqual(["revenue"]);
  });

  it("a row that has nothing left is deleted, not zeroed — `null` and `[]` stay distinct facts", async () => {
    const captured = {};
    const fake = identityFake({
      grants: [],
      roleConfig: { scope_ids: ["compliance_open"], default_ids: ["compliance_open"], locked_ids: ["compliance_open"] },
      captured,
    });
    const out = await roleKpiService.pruneUnreadable(fake, "r1");
    expect(out.cleared).toBe(true);
    expect(captured.deleted).toBe("r1");
  });

  it("no row, no query storm: returns null without touching UPDATE", async () => {
    const captured = {};
    const fake = identityFake({ grants: allGrants, captured });
    const out = await roleKpiService.pruneUnreadable(fake, "missing-role");
    expect(out).toBeNull();
    expect((captured.sql || []).some((q) => /UPDATE role_kpi_config/.test(q.s))).toBe(false);
  });

  it("the permission write hooks it: an un-readable grant upsert triggers the prune", async () => {
    const spy = jest.spyOn(roleKpiService, "pruneUnreadable").mockResolvedValue(null);
    const captured = {};
    const fake = identityFake({
      grants: [],
      captured,
      // upsertGrant's repo call returns the fresh row — can_read false, which
      // is exactly the revocation the hook listens for.
    });
    fake.query = async (sql) => {
      const s = String(sql);
      if (/INSERT INTO permission/.test(s)) {
        return { rows: [{ permission_id: "p1", role_id: "r1", module_key: "MOD-65", can_read: false }] };
      }
      return { rows: [] };
    };
    await permissionService.upsertGrant(fake, {
      data: { role_id: "r1", module_key: "MOD-65", can_read: false },
      actor: { user_id: "u1", display_name: "A", email: "a@t" },
    });
    expect(spy).toHaveBeenCalledWith(expect.anything(), "r1");
    spy.mockRestore();
  });
});
