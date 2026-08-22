"use strict";
/**
 * The service-type half of a reference — `SM` in `SL7Z3K9QW2M4XBSM`.
 *
 * THE PARITY TEST IS THE POINT OF THIS FILE. The shipped codes are written down
 * twice: once as `DEFAULT_SERVICE_CODES` in the allocator, and once as the seed
 * in migration 0682 that gives every existing tenant its codes. Two copies of a
 * mapping is exactly the drift this repo keeps paying for — the transport-
 * reference normaliser was written three times and had already diverged before
 * anyone noticed — so this reads BOTH FILES and fails when they stop agreeing.
 *
 * Which matters more than it sounds: a tenant seeded by the migration and a
 * service type created afterwards through the API would otherwise get different
 * codes for the same service, and their references would silently disagree about
 * what kind of job the file is.
 */
const fs = require("fs");
const path = require("path");
const {
  deriveServiceCode,
  serviceTypeCode,
  DEFAULT_SERVICE_CODES,
  GENERIC_SERVICE_CODE,
} = require("../../src/services/documents/operation-reference");

const MIGRATION = path.join(__dirname, "..", "..", "migrations", "tenant", "0682_operation_reference.sql");

describe("the shipped codes", () => {
  it("cover the fourteen service types the taxonomy ships with", () => {
    expect(Object.keys(DEFAULT_SERVICE_CODES)).toHaveLength(14);
    expect(DEFAULT_SERVICE_CODES.SEA_FREIGHT_IMPORT).toBe("SM");
    expect(DEFAULT_SERVICE_CODES.HINTERLAND_TRANSIT).toBe("HT");
    expect(DEFAULT_SERVICE_CODES.END_TO_END_SEA_FREIGHT).toBe("EF");
    expect(DEFAULT_SERVICE_CODES.RAIL_TRANSPORTATION).toBe("RT");
    expect(DEFAULT_SERVICE_CODES.RAIL_HINTERLAND_TRANSIT).toBe("RH");
  });

  it("are all two legal characters and all distinct", () => {
    const codes = Object.values(DEFAULT_SERVICE_CODES);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{2}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never claim the marker reserved for a file with no service type", () => {
    expect(Object.values(DEFAULT_SERVICE_CODES)).not.toContain(GENERIC_SERVICE_CODE);
  });

  it("match migration 0682's seed, key for key", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const seeded = {};
    for (const [, key, code] of sql.matchAll(/'([A-Z][A-Z0-9_]+)',\s*'([A-Z0-9]{2})'/g)) {
      seeded[key] = code;
    }
    expect(seeded).toEqual(DEFAULT_SERVICE_CODES);
  });
});

describe("deriving a code for a service type nobody shipped", () => {
  it("takes the initials of the first two words of the key", () => {
    expect(deriveServiceCode("COLD_CHAIN")).toBe("CC");
    expect(deriveServiceCode("RAIL_FREIGHT_IMPORT")).toBe("RF");
  });

  it("falls back to the first two letters of a single-word key", () => {
    expect(deriveServiceCode("BUNKERING")).toBe("BU");
  });

  it("prefers the shipped code over the derivation", () => {
    // WAREHOUSING would derive as WA; the business already reads WH.
    expect(deriveServiceCode("WAREHOUSING")).toBe("WH");
    expect(deriveServiceCode("PROJECT_CARGO")).toBe("PC");
  });

  it("is case-insensitive about the key it is handed", () => {
    expect(deriveServiceCode("sea_freight_import")).toBe("SM");
  });

  it("is a PREFERENCE — the reserved marker is refused at assignment, not here", async () => {
    // OPEN_POLICY prefers OP, which is what a file with NO service type uses.
    // Special-casing it in the derivation looked tidier and was the bug: the
    // SQL seed has no such case, so the two sides handed the same key different
    // codes. The candidate walk skips OP in both, and lands on OA in both.
    expect(deriveServiceCode("OPEN_POLICY")).toBe(GENERIC_SERVICE_CODE);
    const rows = [{ service_type_id: "st1", ops_reference_code: null, key: "OPEN_POLICY" }];
    await expect(serviceTypeCode(fakeServiceTypes(rows), "st1")).resolves.toBe("OA");
  });

  it("answers with two legal characters for anything at all", () => {
    for (const junk of ["", "  ", "___", null, undefined]) {
      expect(deriveServiceCode(junk)).toMatch(/^[A-Z0-9]{2}$/);
    }
  });
});

function fakeServiceTypes(rows) {
  const state = { sql: [], rows };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
      if (/^SELECT ops_reference_code AS marker FROM service_type WHERE service_type_id/i.test(s)) {
        const row = state.rows.find((r) => r.service_type_id === params[0]);
        return { rows: row ? [{ marker: row.ops_reference_code }] : [] };
      }
      if (/^SELECT ops_reference_code AS marker FROM service_type WHERE ops_reference_code IS NOT NULL/i.test(s)) {
        return { rows: state.rows.filter((r) => r.ops_reference_code).map((r) => ({ marker: r.ops_reference_code })) };
      }
      if (/^SELECT ops_reference_code, key FROM service_type/i.test(s)) {
        const row = state.rows.find((r) => r.service_type_id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/^UPDATE service_type SET ops_reference_code/i.test(s)) {
        const row = state.rows.find((r) => r.service_type_id === params[0]);
        if (!row || row.ops_reference_code) return { rows: [] };
        if (state.rows.some((r) => r.ops_reference_code === params[1])) {
          const err = new Error("duplicate key");
          err.code = "23505";
          err.constraint = "ux_service_type_ops_reference_code";
          throw err;
        }
        row.ops_reference_code = params[1];
        return { rows: [{ marker: params[1] }] };
      }
      throw new Error("Unmatched SQL in fakeServiceTypes: " + s.slice(0, 160));
    },
  };
}

describe("assigning a code to a service type", () => {
  it("returns the stored one", async () => {
    const c = fakeServiceTypes([{ service_type_id: "st1", ops_reference_code: "SM", key: "SEA_FREIGHT_IMPORT" }]);
    await expect(serviceTypeCode(c, "st1")).resolves.toBe("SM");
    expect(c.state.sql.some((s) => /^UPDATE/i.test(s))).toBe(false);
  });

  it("derives and persists one when the service type has none", async () => {
    const rows = [{ service_type_id: "st1", ops_reference_code: null, key: "SEA_FREIGHT_IMPORT" }];
    await expect(serviceTypeCode(fakeServiceTypes(rows), "st1")).resolves.toBe("SM");
    expect(rows[0].ops_reference_code).toBe("SM");
  });

  it("walks past a code another service type already holds", async () => {
    const rows = [
      { service_type_id: "st1", ops_reference_code: "SM", key: "SEA_FREIGHT_IMPORT" },
      { service_type_id: "st2", ops_reference_code: null, key: "SEA_MULTIMODAL" },
    ];
    await expect(serviceTypeCode(fakeServiceTypes(rows), "st2")).resolves.toBe("SA");
    expect(rows[0].ops_reference_code).toBe("SM"); // stable
  });

  it("is stable — a second read never re-derives", async () => {
    const rows = [{ service_type_id: "st1", ops_reference_code: null, key: "COLD_CHAIN" }];
    const first = await serviceTypeCode(fakeServiceTypes(rows), "st1");
    const c = fakeServiceTypes(rows);
    expect(await serviceTypeCode(c, "st1")).toBe(first);
    expect(c.state.sql.some((s) => /^UPDATE/i.test(s))).toBe(false);
  });

  it("gives a file with no service type the reserved marker, without a lookup", async () => {
    const c = fakeServiceTypes([]);
    await expect(serviceTypeCode(c, null)).resolves.toBe(GENERIC_SERVICE_CODE);
    expect(c.state.sql).toHaveLength(0);
  });

  it("still allocates when the service type row has gone", async () => {
    // A dossier can hold a service_type_id whose row was removed. The file must
    // still get a reference — the alternative is a file that cannot be opened.
    await expect(serviceTypeCode(fakeServiceTypes([]), "vanished")).resolves.toBe(GENERIC_SERVICE_CODE);
  });
});

/**
 * The administration rule. Same shape as the entity prefix: editable while
 * nothing has used it, frozen afterwards — and RENAMING the service type stays
 * free either way, which is the point of keeping the code in its own column
 * rather than deriving it from the name.
 */
describe("changing a service type's code", () => {
  const serviceTypeService = require("../../src/modules/operations/service_type/service_type.service");

  function fakeAdmin({ row, hasFiles = false, taken = false }) {
    const state = { row, sql: [], updates: [] };
    return {
      state,
      async query(sql, params = []) {
        const s = String(sql).replace(/\s+/g, " ").trim();
        state.sql.push(s);
        if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
        if (/^SELECT ops_reference_code FROM service_type WHERE service_type_id/i.test(s)) {
          return { rows: state.row ? [{ ops_reference_code: state.row.ops_reference_code }] : [] };
        }
        if (/FROM dossier_visible/i.test(s)) return { rows: hasFiles ? [{ n: 1 }] : [], rowCount: hasFiles ? 1 : 0 };
        if (/^SELECT \* FROM "?service_type"? WHERE "?service_type_id"?/i.test(s)) {
          return { rows: state.row ? [state.row] : [] };
        }
        if (/^UPDATE "?service_type"?/i.test(s)) {
          state.updates.push(params);
          if (taken) {
            const err = new Error("duplicate key");
            err.code = "23505";
            err.constraint = "ux_service_type_ops_reference_code";
            throw err;
          }
          // Mirror the SET list onto the row rather than assuming a parameter
          // position — this suite asserts what a NAME edit does as well as what
          // a code edit does, and the two write different columns.
          const set = /SET (.*?) WHERE/i.exec(s);
          for (const [, col, idx] of (set ? set[1] : "").matchAll(/"?([a-z_]+)"?\s*=\s*\$(\d+)/g)) {
            if (col !== "updated_at") state.row = { ...state.row, [col]: params[Number(idx) - 1] };
          }
          return { rows: [state.row] };
        }
        if (/event_log|immutable_ledger|audit|outbox|event_type/i.test(s)) return { rows: [{ id: 1 }] };
        if (/FROM app_user/i.test(s)) return { rows: [{ user_id: null }] };
        throw new Error("Unmatched SQL in fakeAdmin: " + s.slice(0, 160));
      },
    };
  }

  const row = (over = {}) => ({
    service_type_id: "st1", key: "SEA_FREIGHT_IMPORT", name_fr: "Fret maritime import",
    ops_reference_code: "SM", ...over,
  });

  it("is allowed while no file has used it", async () => {
    const c = fakeAdmin({ row: row(), hasFiles: false });
    const out = await serviceTypeService.update(c, { id: "st1", patch: { ops_reference_code: "SX" }, actor: {} });
    expect(out.ops_reference_code).toBe("SX");
  });

  it("is REFUSED once an operation file carries it", async () => {
    const c = fakeAdmin({ row: row(), hasFiles: true });
    await expect(
      serviceTypeService.update(c, { id: "st1", patch: { ops_reference_code: "SX" }, actor: {} }),
    ).rejects.toMatchObject({ code: "CODE_IN_USE", status: 422 });
    expect(c.state.updates).toHaveLength(0);
  });

  it("still lets the service type be RENAMED after files have used its code", async () => {
    // The whole reason the code is its own column: display names stay editable
    // and historical references keep meaning what they meant.
    const c = fakeAdmin({ row: row(), hasFiles: true });
    const out = await serviceTypeService.update(c, { id: "st1", patch: { name_en: "Ocean import" }, actor: {} });
    expect(out.name_en).toBe("Ocean import");
    expect(out.ops_reference_code).toBe("SM");
  });

  it("refuses the marker reserved for files with no service type", async () => {
    const c = fakeAdmin({ row: row(), hasFiles: false });
    await expect(
      serviceTypeService.update(c, { id: "st1", patch: { ops_reference_code: GENERIC_SERVICE_CODE }, actor: {} }),
    ).rejects.toMatchObject({ code: "CODE_RESERVED", status: 422 });
  });

  it("names the field when another service type already holds the code", async () => {
    const c = fakeAdmin({ row: row(), hasFiles: false, taken: true });
    await expect(
      serviceTypeService.update(c, { id: "st1", patch: { ops_reference_code: "HT" }, actor: {} }),
    ).rejects.toMatchObject({ code: "OPS_CODE_TAKEN", details: { ops_reference_code: ["already in use"] } });
  });

  it("lets a service type that has no code yet be given one, files or not", async () => {
    const c = fakeAdmin({ row: row({ ops_reference_code: null }), hasFiles: true });
    const out = await serviceTypeService.update(c, { id: "st1", patch: { ops_reference_code: "SM" }, actor: {} });
    expect(out.ops_reference_code).toBe("SM");
  });
});
