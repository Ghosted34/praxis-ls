"use strict";
/**
 * Where a file's reference comes from, and where it must never come from.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * The backend allocates it. Nothing else may. That is stronger than "the form
 * doesn't have a box for it", and the difference is the whole reason this file
 * exists: `service.create` is reached by four callers, and only ONE of them has
 * a zod schema in front of it.
 *
 *   POST /operations                          validator.create  (strips `ref`)
 *   opportunity.win({ createDossier })        in process
 *   orchestration/opportunity-won-open-dossier in process, from an outbox event
 *   services/ai/action-registry               in process
 *
 * Until this change the service read `write.ref` and used it when present, so
 * three of those four could choose a dossier's reference — including the AI
 * path, whose payload is model output. A reference anyone can choose is a
 * reference nobody can rely on being unguessable.
 *
 * ── AND WHAT MUST KEEP WORKING ──────────────────────────────────────────────
 *
 * Every reference already issued stays valid and findable: the legacy PHP
 * shape, the sequential shape this replaces, and the new opaque one. No
 * migration rewrites any of them, and search reaches all three.
 */
const service = require("../../src/modules/operations/operations_file/operations_file.service");
const { schemas } = require("../../src/modules/operations/operations_file/operations_file.validator");
const repo = require("../../src/modules/operations/operations_file/operations_file.repo");
const { classifyReference } = require("../../src/services/documents/operation-reference");

function fakeClient({ dossier = null, prefix = "SL", code = "SM" } = {}) {
  const state = { dossier, inserted: null, sql: [], params: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      state.params.push(params);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
      if (/^SELECT ops_reference_prefix, trading_name, legal_name/i.test(s)) {
        return { rows: [{ ops_reference_prefix: prefix, trading_name: "Smart Logistics", legal_name: null }] };
      }
      if (/^SELECT ops_reference_code, key FROM service_type/i.test(s)) {
        return { rows: [{ ops_reference_code: code, key: "SEA_FREIGHT_IMPORT" }] };
      }
      if (/^INSERT INTO "?dossier"?/i.test(s)) {
        const m = /\(([^)]+)\)/.exec(s);
        const cols = (m ? m[1] : "").split(",").map((x) => x.trim().replace(/"/g, ""));
        state.inserted = Object.fromEntries(cols.map((col, i) => [col, params[i]]));
        state.dossier = { dossier_id: "d-new", status: "OPEN", ...state.inserted };
        return { rows: [state.dossier] };
      }
      if (/^SELECT \* FROM "?dossier"? WHERE "?dossier_id"?/i.test(s)) {
        return { rows: state.dossier ? [state.dossier] : [] };
      }
      if (/^UPDATE "?dossier"?/i.test(s)) {
        const cols = [...s.matchAll(/"?([a-z_]+)"?\s*=\s*\$(\d+)/g)].map(([, col, idx]) => [col, params[Number(idx) - 1]]);
        for (const [col, value] of cols) if (col !== "updated_at") state.dossier[col] = value;
        return { rows: [state.dossier] };
      }
      if (/event_log|immutable_ledger|audit|outbox|event_type/i.test(s)) return { rows: [{ id: 1 }] };
      if (/FROM app_user/i.test(s)) return { rows: [{ user_id: null }] };
      if (/service_type_field_set|service_type_field/i.test(s)) return { rows: [] };
      if (/FROM service_type|FROM client_master|compliance|milestone|itinerary|geo_place/i.test(s)) return { rows: [] };
      throw new Error("Unmatched SQL in fakeClient: " + s.slice(0, 180));
    },
  };
}

describe("the validator never lets a reference in from the browser", () => {
  it("strips `ref` from a create body", () => {
    const parsed = schemas.create.parse({ entity_id: "11111111-1111-4111-8111-111111111111", ref: "SLHACKEDHACKSM" });
    expect(parsed).not.toHaveProperty("ref");
  });

  it("strips `ref` from a promote body", () => {
    const parsed = schemas.promote.parse({ ref: "SLHACKEDHACKSM", incoterm: "CIF" });
    expect(parsed).not.toHaveProperty("ref");
    expect(parsed.incoterm).toBe("CIF");
  });

  it("strips `ref` from an update body", () => {
    const parsed = schemas.update.parse({ ref: "SLHACKEDHACKSM", pol: "Douala" });
    expect(parsed).not.toHaveProperty("ref");
    expect(parsed.pol).toBe("Douala");
  });

  it("strips `ref` from the AI-facing update too", () => {
    const parsed = schemas.aiUpdate.parse({
      dossier_id: "11111111-1111-4111-8111-111111111111",
      ref: "SLHACKEDHACKSM",
    });
    expect(parsed).not.toHaveProperty("ref");
  });
});

describe("creating a file", () => {
  it("allocates the reference itself, in the canonical shape", async () => {
    const c = fakeClient();
    const row = await service.create(c, { data: { entity_id: "e1", service_type_id: "st1" }, actor: {} });
    expect(row.ref).toMatch(/^SL[0-9A-HJKMNP-TV-Z]{12}SM$/);
    expect(classifyReference(row.ref)).toBe("MODERN_OPAQUE");
  });

  it("ignores a `ref` handed to it in process — the AI and handoff paths", async () => {
    const c = fakeClient();
    const row = await service.create(c, {
      data: { entity_id: "e1", service_type_id: "st1", ref: "SLHACKEDHACKSM" },
      actor: {},
    });
    expect(row.ref).not.toBe("SLHACKEDHACKSM");
    expect(row.ref).toMatch(/^SL[0-9A-HJKMNP-TV-Z]{12}SM$/);
    // And the value never reached the INSERT.
    expect(c.state.params.flat()).not.toContain("SLHACKEDHACKSM");
  });

  it("burns no doc_sequence — the file's number is not an accounting number", async () => {
    const c = fakeClient();
    await service.create(c, { data: { entity_id: "e1", service_type_id: "st1" }, actor: {} });
    expect(c.state.sql.some((s) => /doc_sequence/i.test(s))).toBe(false);
  });

  it("still refuses to open a file with no entity to take a prefix from", async () => {
    const c = fakeClient();
    await expect(service.create(c, { data: {}, actor: {} })).rejects.toMatchObject({ code: "REF_REQUIRED" });
  });

  it("closes the reference with the generic marker when there is no service type", async () => {
    const c = fakeClient();
    const row = await service.create(c, { data: { entity_id: "e1" }, actor: {} });
    expect(row.ref).toMatch(/^SL[0-9A-HJKMNP-TV-Z]{12}OP$/);
  });

  it("gives two files opened back to back unrelated references", async () => {
    const a = await service.create(fakeClient(), { data: { entity_id: "e1", service_type_id: "st1" }, actor: {} });
    const b = await service.create(fakeClient(), { data: { entity_id: "e1", service_type_id: "st1" }, actor: {} });
    expect(a.ref).not.toBe(b.ref);
    // Same prefix and code — that half IS meant to be recognisable.
    expect(a.ref.slice(0, 2)).toBe(b.ref.slice(0, 2));
    expect(a.ref.slice(-2)).toBe(b.ref.slice(-2));
    // …and no arithmetic relationship between the cores.
    expect(a.ref.slice(2, -2)).not.toBe(b.ref.slice(2, -2));
  });
});

describe("promoting a draft", () => {
  const draft = () => ({
    dossier_id: "d1",
    ref: "DRAFT-8f14e45f-ea6b-4c1f-9a2e-1d0c2b3a4e5f",
    status: "DRAFT",
    entity_id: "e1",
    service_type_id: "st1",
    details_json: {},
  });

  it("swaps the placeholder for an allocated reference", async () => {
    const c = fakeClient({ dossier: draft() });
    const row = await service.promote(c, { id: "d1", data: {}, actor: {} });
    expect(row.status).toBe("OPEN");
    expect(row.ref).toMatch(/^SL[0-9A-HJKMNP-TV-Z]{12}SM$/);
    expect(classifyReference(row.ref)).toBe("MODERN_OPAQUE");
  });

  it("ignores a `ref` supplied at promotion", async () => {
    const c = fakeClient({ dossier: draft() });
    const row = await service.promote(c, { id: "d1", data: { ref: "SLHACKEDHACKSM" }, actor: {} });
    expect(row.ref).not.toBe("SLHACKEDHACKSM");
  });

  it("burns no doc_sequence either", async () => {
    const c = fakeClient({ dossier: draft() });
    await service.promote(c, { id: "d1", data: {}, actor: {} });
    expect(c.state.sql.some((s) => /doc_sequence/i.test(s))).toBe(false);
  });
});

/**
 * Three schemes, one search box. `dossier.ref` holds whatever was allocated at
 * the time and nothing rewrites it, so the query has to reach all three — and,
 * for the opaque scheme, the DISPLAY spelling as well, because that is the form
 * a person copies out of an email.
 */
describe("search reaches every scheme", () => {
  const captured = [];
  const client = {
    async query(sql, params) {
      captured.push({ sql: String(sql).replace(/\s+/g, " "), params });
      return { rows: [] };
    },
  };

  beforeEach(() => {
    captured.length = 0;
  });

  it("matches a reference typed in any of the three shapes", async () => {
    for (const q of ["SL6721864SM", "SLAS-OPS-2026-0142", "SL7Z3K9QW2M4XBSM"]) {
      await repo.listPaged(client, { q });
      const call = captured[captured.length - 1];
      expect(call.sql).toMatch(/d\.ref ILIKE/);
      expect(call.params).toContain("%" + q + "%");
    }
  });

  it("also matches the canonical form when the display form is pasted in", async () => {
    await repo.listPaged(client, { q: "SL-7Z3K9QW2M4XB-SM" });
    const call = captured[0];
    expect(call.sql).toMatch(/upper\(d\.ref\) = \$\d+/);
    expect(call.params).toContain("SL7Z3K9QW2M4XBSM");
  });

  it("does not pay for the extra clause on an ordinary search", async () => {
    await repo.listPaged(client, { q: "Douala" });
    expect(captured[0].sql).not.toMatch(/upper\(d\.ref\)/);
    // A sequential reference contains hyphens but IS the stored spelling, so
    // stripping them would search for something no row holds.
    await repo.listPaged(client, { q: "SLAS-OPS-2026-0142" });
    expect(captured[1].params).toContain("SLASOPS20260142");
    expect(captured[1].params).toContain("%SLAS-OPS-2026-0142%");
  });

  it("still searches the other three fields it advertises", async () => {
    await repo.listPaged(client, { q: "MAEU123" });
    expect(captured[0].sql).toMatch(/cm\.name ILIKE/);
    expect(captured[0].sql).toMatch(/d\.bl_mawb ILIKE/);
    expect(captured[0].sql).toMatch(/d\.vessel_flight ILIKE/);
  });
});
