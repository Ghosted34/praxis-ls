"use strict";
/**
 * The entity's two-character operation-reference prefix.
 *
 * The prefix is the half of a reference a human reads — "that's one of ours" —
 * and it is assigned once and then quoted to clients forever. Two properties
 * carry all the weight:
 *
 *   DETERMINISM. "What would this name be given" must have exactly one answer,
 *   today, on a restored backup, and in the SQL that seeds existing rows. A
 *   fallback that depended on iteration order or on `Math.random` would produce
 *   a different prefix on a re-seed and the two databases would disagree about
 *   what an entity is called.
 *
 *   STABILITY. Creating a SECOND entity must never change the FIRST one's
 *   prefix. That is why it is a persisted column rather than something derived
 *   at allocation time — the derived version silently renames every new file of
 *   an entity the day a similarly-named one is added.
 */
const fs = require("fs");
const path = require("path");
const {
  derivePrefix,
  markerCandidates,
  entityPrefix,
  FALLBACK_CHARS,
} = require("../../src/services/documents/operation-reference");

describe("deriving a prefix from an entity name", () => {
  it("takes the initials of the first two words", () => {
    expect(derivePrefix("Smart Logistics")).toBe("SL");
    expect(derivePrefix("Base Cameroon Limited")).toBe("BC");
    expect(derivePrefix("Trans Africa Freight Services")).toBe("TA");
  });

  it("falls back to the first two letters of a single word", () => {
    expect(derivePrefix("Praxis")).toBe("PR");
    expect(derivePrefix("Bolloré")).toBe("BO");
  });

  it("folds accents rather than dropping the letter or splitting the word", () => {
    // NFD turns "É" into "E" + a combining accent. Strip the accent and the
    // word survives; treat the accent as a separator and "Étoile" becomes "E"
    // and "toile", which yields ET instead of EL.
    expect(derivePrefix("Étoile Logistique")).toBe("EL");
    expect(derivePrefix("Société Générale de Transit")).toBe("SG");
  });

  it("treats punctuation as a word break, not as a character to delete", () => {
    // Deleting the hyphen would join the words and give SM.
    expect(derivePrefix("Smart-Logistics")).toBe("SL");
    expect(derivePrefix("Smart & Logistics")).toBe("SL");
    expect(derivePrefix("SMART_LOGISTICS SARL")).toBe("SL");
  });

  it("always answers with two legal characters, whatever it is handed", () => {
    for (const junk of ["", "   ", "!!!", "—", null, undefined, "X"]) {
      expect(derivePrefix(junk)).toMatch(/^[A-Z0-9]{2}$/);
    }
    expect(derivePrefix("7 Seas")).toBe("7S");
  });

  it("is a pure function of the name — same input, same answer, always", () => {
    const once = derivePrefix("Smart Logistics");
    for (let i = 0; i < 50; i += 1) expect(derivePrefix("Smart Logistics")).toBe(once);
  });
});

describe("the fallback walk", () => {
  it("offers the preferred prefix first", () => {
    expect(markerCandidates("SL")[0]).toBe("SL");
  });

  it("then varies the second character, keeping the entity's own initial", () => {
    const c = markerCandidates("SL");
    expect(c.slice(1, 4)).toEqual(["SA", "SB", "SC"]);
    // Letters before digits — a two-letter prefix reads as a name.
    expect(c.indexOf("SZ")).toBeLessThan(c.indexOf("S2"));
    // The preferred value is not offered twice.
    expect(c.filter((x) => x === "SL")).toHaveLength(1);
  });

  it("eventually covers the whole two-character space, with no duplicates", () => {
    const c = markerCandidates("SL");
    expect(c).toHaveLength(FALLBACK_CHARS.length * FALLBACK_CHARS.length + 1);
    expect(new Set(c).size).toBe(c.length);
    expect(c).toContain("XY");
  });

  it("skips reserved markers entirely", () => {
    expect(markerCandidates("OP", { reserved: ["OP"] })).not.toContain("OP");
  });

  it("produces the same ordering every time it is asked", () => {
    expect(markerCandidates("SL")).toEqual(markerCandidates("SL"));
  });
});

/** A client modelling only `corporate_entity` — see the collision suite's note. */
function fakeEntities(rows) {
  const state = { sql: [], rows };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
      // Matched before the taken-set read below: both start the same way, and
      // the entity_id one is the narrower of the two.
      if (/^SELECT ops_reference_prefix AS marker FROM corporate_entity WHERE entity_id/i.test(s)) {
        const row = state.rows.find((r) => r.entity_id === params[0]);
        return { rows: row ? [{ marker: row.ops_reference_prefix }] : [] };
      }
      if (/^SELECT ops_reference_prefix AS marker FROM corporate_entity WHERE ops_reference_prefix IS NOT NULL/i.test(s)) {
        return { rows: state.rows.filter((r) => r.ops_reference_prefix).map((r) => ({ marker: r.ops_reference_prefix })) };
      }
      if (/^SELECT ops_reference_prefix, trading_name, legal_name/i.test(s)) {
        const row = state.rows.find((r) => r.entity_id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/^UPDATE corporate_entity SET ops_reference_prefix/i.test(s)) {
        const row = state.rows.find((r) => r.entity_id === params[0]);
        if (!row || row.ops_reference_prefix) return { rows: [] };
        if (state.rows.some((r) => r.ops_reference_prefix === params[1])) {
          const err = new Error("duplicate key");
          err.code = "23505";
          err.constraint = "ux_corporate_entity_ops_reference_prefix";
          throw err;
        }
        row.ops_reference_prefix = params[1];
        return { rows: [{ marker: params[1] }] };
      }
      throw new Error("Unmatched SQL in fakeEntities: " + s.slice(0, 160));
    },
  };
}

describe("assigning a prefix to an entity", () => {
  it("returns the stored one without touching the name", async () => {
    const c = fakeEntities([{ entity_id: "e1", ops_reference_prefix: "ZZ", trading_name: "Smart Logistics" }]);
    await expect(entityPrefix(c, "e1")).resolves.toBe("ZZ");
    expect(c.state.sql.some((s) => /^UPDATE/i.test(s))).toBe(false);
  });

  it("derives and PERSISTS one when the entity has none", async () => {
    const rows = [{ entity_id: "e1", ops_reference_prefix: null, trading_name: "Smart Logistics", legal_name: null }];
    const c = fakeEntities(rows);
    await expect(entityPrefix(c, "e1")).resolves.toBe("SL");
    expect(rows[0].ops_reference_prefix).toBe("SL");
    // Persisted means the SECOND call is a read, not a fresh derivation.
    const c2 = fakeEntities(rows);
    await expect(entityPrefix(c2, "e1")).resolves.toBe("SL");
    expect(c2.state.sql.some((s) => /^UPDATE/i.test(s))).toBe(false);
  });

  it("uses the legal name when there is no trading name", async () => {
    const rows = [{ entity_id: "e1", ops_reference_prefix: null, trading_name: null, legal_name: "Base Cameroon Limited" }];
    await expect(entityPrefix(fakeEntities(rows), "e1")).resolves.toBe("BC");
  });

  it("cannot assign a prefix another entity already holds", async () => {
    const rows = [
      { entity_id: "e1", ops_reference_prefix: "SL", trading_name: "Smart Logistics" },
      { entity_id: "e2", ops_reference_prefix: null, trading_name: "Speedy Lines" },
    ];
    await expect(entityPrefix(fakeEntities(rows), "e2")).resolves.toBe("SA");
    expect(rows[0].ops_reference_prefix).toBe("SL"); // untouched
    expect(rows[1].ops_reference_prefix).toBe("SA");
  });

  it("does not renumber the first entity when a second one wants the same initials", async () => {
    const rows = [
      { entity_id: "e1", ops_reference_prefix: null, trading_name: "Smart Logistics" },
      { entity_id: "e2", ops_reference_prefix: null, trading_name: "Smart Logistique" },
      { entity_id: "e3", ops_reference_prefix: null, trading_name: "Smart Lines" },
    ];
    expect(await entityPrefix(fakeEntities(rows), "e1")).toBe("SL");
    expect(await entityPrefix(fakeEntities(rows), "e2")).toBe("SA");
    expect(await entityPrefix(fakeEntities(rows), "e3")).toBe("SB");
    // The first entity keeps what it was given — every reference already issued
    // under SL still reads as belonging to it.
    expect(await entityPrefix(fakeEntities(rows), "e1")).toBe("SL");
  });

  it("takes the prefix a concurrent caller assigned rather than fighting for one", async () => {
    const rows = [
      { entity_id: "other", ops_reference_prefix: "SL" },
      { entity_id: "e1", ops_reference_prefix: null, trading_name: "Smart Logistics" },
    ];
    const c = fakeEntities(rows);
    const inner = c.query.bind(c);
    c.query = async (sql, params) => {
      // Another request wins the race between the taken-set read and our UPDATE.
      if (/^UPDATE corporate_entity/i.test(String(sql).trim()) && rows[1].ops_reference_prefix === null) {
        rows[1].ops_reference_prefix = "QQ";
      }
      return inner(sql, params);
    };
    await expect(entityPrefix(c, "e1")).resolves.toBe("QQ");
  });

  it("refuses to allocate without an entity", async () => {
    await expect(entityPrefix(fakeEntities([]), null)).rejects.toMatchObject({ code: "REF_ENTITY_REQUIRED" });
    await expect(entityPrefix(fakeEntities([]), "missing")).rejects.toMatchObject({ code: "REF_ENTITY_REQUIRED" });
  });
});

/**
 * Tenant scope. The prefix is unique per SCHEMA — and each tenant has its own
 * database, with `live` and `sandbox` as separate schemas inside it — so two
 * tenants both using SL is correct, not a collision. The index is what says so,
 * and it is asserted against the migration rather than against a live database
 * so the claim fails in the fast suite if the migration is ever changed.
 */
describe("uniqueness is scoped to the tenant, not the fleet", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "migrations", "tenant", "0681_operation_reference.sql"),
    "utf8",
  );

  it("declares an unqualified unique index, so it is created per schema", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS ux_corporate_entity_ops_reference_prefix\s+ON corporate_entity\(ops_reference_prefix\)/,
    );
    // Unqualified: no `public.` / `live.` prefix, which is what makes the
    // migrator create one inside each environment schema.
    expect(sql).not.toMatch(/ON (public|live|sandbox)\.corporate_entity\(ops_reference_prefix\)/);
  });

  it("constrains the shape in the database as well as in the schema", () => {
    expect(sql).toMatch(/chk_entity_ops_reference_prefix[\s\S]*?ops_reference_prefix ~ '\^\[A-Z0-9\]\{2\}\$'/);
  });

  it("seeds existing entities in a deterministic order", () => {
    // `created_at, entity_id` — without an ORDER BY, two runs of the seed could
    // hand the same preferred prefix to different entities.
    expect(sql).toMatch(/FROM corporate_entity\s+WHERE ops_reference_prefix IS NULL\s+ORDER BY created_at, entity_id/);
  });
});

/**
 * The administration rule, which is what makes the prefix trustworthy rather
 * than merely present: a prefix that any admin could change at any moment is a
 * prefix no reference can rely on meaning anything.
 */
describe("changing an entity's prefix", () => {
  const entityService = require("../../src/modules/master/corporate_entity/corporate_entity.service");

  function fakeEntityAdmin({ entity, hasFiles = false }) {
    const state = { entity, sql: [], updates: [], audits: 0 };
    return {
      state,
      async query(sql, params = []) {
        const s = String(sql).replace(/\s+/g, " ").trim();
        state.sql.push(s);
        if (/^SELECT \* FROM "?corporate_entity"? WHERE "?entity_id"?/i.test(s)) {
          return { rows: state.entity ? [state.entity] : [] };
        }
        if (/FROM dossier_visible/i.test(s)) return { rows: hasFiles ? [{ "?column?": 1 }] : [], rowCount: hasFiles ? 1 : 0 };
        if (/^UPDATE "?corporate_entity"?/i.test(s)) {
          state.updates.push(params);
          if (params.includes("ZZ")) {
            const err = new Error("duplicate key");
            err.code = "23505";
            err.constraint = "ux_corporate_entity_ops_reference_prefix";
            throw err;
          }
          state.entity = { ...state.entity, ops_reference_prefix: params[params.length - 1] };
          return { rows: [state.entity] };
        }
        if (/event_log|immutable_ledger|audit|outbox|event_type/i.test(s)) { state.audits += 1; return { rows: [{ id: 1 }] }; }
        if (/FROM app_user/i.test(s)) return { rows: [{ user_id: null }] };
        throw new Error("Unmatched SQL in fakeEntityAdmin: " + s.slice(0, 160));
      },
    };
  }

  const entity = (over = {}) => ({ entity_id: "e1", legal_name: "Smart Logistics", ops_reference_prefix: "SL", ...over });

  it("is allowed while no file has used it", async () => {
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: false });
    const row = await entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "SX", actor: {} });
    expect(row.ops_reference_prefix).toBe("SX");
  });

  it("is REFUSED once an operation file carries it", async () => {
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: true });
    await expect(
      entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "SX", actor: {} }),
    ).rejects.toMatchObject({ code: "PREFIX_IN_USE", status: 422 });
    expect(c.state.updates).toHaveLength(0);
  });

  it("ignores drafts — a half-finished wizard file holds no reference to protect", async () => {
    // `dossier_visible` excludes DRAFT, so the "has a file used this" question
    // is asked of promoted files only.
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: false });
    await entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "SX", actor: {} });
    expect(c.state.sql.some((s) => /FROM dossier_visible/i.test(s))).toBe(true);
    expect(c.state.sql.some((s) => /FROM dossier\b(?!_)/i.test(s))).toBe(false);
  });

  it("is a no-op when the prefix is already what was asked for", async () => {
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: true });
    const row = await entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "SL", actor: {} });
    expect(row.ops_reference_prefix).toBe("SL");
    expect(c.state.updates).toHaveLength(0);
  });

  it("names the field when another entity already holds the prefix", async () => {
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: false });
    await expect(
      entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "ZZ", actor: {} }),
    ).rejects.toMatchObject({ code: "PREFIX_TAKEN", details: { ops_reference_prefix: ["already in use"] } });
  });

  it("records the change on its own audit action", async () => {
    const c = fakeEntityAdmin({ entity: entity(), hasFiles: false });
    await entityService.setOpsReferencePrefix(c, { id: "e1", prefix: "SX", actor: { user_id: "u1" } });
    expect(c.state.audits).toBeGreaterThan(0);
    const events = require("../../src/modules/master/corporate_entity/corporate_entity.events");
    expect(events.OPS_PREFIX_CHANGED).toBe("entity.ops_reference_prefix_changed");
  });

  it("is a 404 for an entity that does not exist", async () => {
    const c = fakeEntityAdmin({ entity: null });
    await expect(
      entityService.setOpsReferencePrefix(c, { id: "nope", prefix: "SX", actor: {} }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
