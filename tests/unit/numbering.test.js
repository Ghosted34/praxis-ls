"use strict";
/** Tenant numbering (BUILD_CONVENTIONS §3/§6): pure format + allocation + scheme. */
const { formatNumber, allocate, schemeFor } = require("../../src/services/documents/numbering.service");

describe("formatNumber", () => {
  it("prefix-code-year-padded", () => {
    expect(formatNumber({ prefix: "SMLS", code: "INV", padding: 4 }, { year: 2026, seq: 7 })).toBe("SMLS-INV-2026-0007");
  });
  it("reset=never drops the year segment", () => {
    expect(formatNumber({ prefix: "DOC", reset: "never", padding: 4 }, { year: 0, seq: 42 })).toBe("DOC-0042");
  });
  it("honours a tenant separator + padding", () => {
    expect(formatNumber({ prefix: "P", code: "JE", separator: "/", padding: 6 }, { year: 2026, seq: 3 })).toBe("P/JE/2026/000003");
  });
});

describe("schemeFor", () => {
  /**
   * `code` used to be the raw module number ("51"), so a document read
   * `DOC-51-2026-0001`. It now defaults to a readable token from MODULE_TOKENS
   * ("INV"), which is the shape this file's own formatNumber cases have always
   * assumed — the difference is that a tenant no longer has to configure it by
   * hand to get it. Unmapped modules still fall back to the number, so the old
   * guarantee holds where there's nothing better to use.
   */
  it("merges tenant override over defaults; code defaults to the module token", async () => {
    const c = { query: async () => ({ rows: [{ value: { prefix: "SMLS", padding: 5 } }] }) };
    const cfg = await schemeFor(c, "MOD-51");
    expect(cfg.prefix).toBe("SMLS");
    expect(cfg.padding).toBe(5);
    expect(cfg.code).toBe("INV");
  });
  it("falls back to defaults when no setting row", async () => {
    const c = { query: async () => ({ rows: [] }) };
    const cfg = await schemeFor(c, "MOD-55");
    expect(cfg.prefix).toBe("DOC");
    expect(cfg.code).toBe("JE");
  });
  it("uses the raw module number for an unmapped module", async () => {
    const c = { query: async () => ({ rows: [] }) };
    const cfg = await schemeFor(c, "MOD-99");
    expect(cfg.code).toBe("99");
  });

  /**
   * The entity's doc_prefix was captured on the corporate-entity form and never
   * read, so every document came out with the generic "DOC" (fixed 2026-08-01).
   * Precedence: DEFAULTS -> module token -> entity prefix -> tenant setting.
   */
  it("takes the prefix from the entity when one is given", async () => {
    const c = {
      query: async (sql) => {
        if (/FROM corporate_entity/.test(sql)) return { rows: [{ doc_prefix: "SLAS" }] };
        return { rows: [] };
      },
    };
    const cfg = await schemeFor(c, "MOD-29", "entity-1");
    expect(cfg.prefix).toBe("SLAS");
    expect(cfg.code).toBe("OPS");
  });
  it("lets a tenant setting override the entity prefix", async () => {
    const c = {
      query: async (sql) => {
        if (/FROM corporate_entity/.test(sql)) return { rows: [{ doc_prefix: "SLAS" }] };
        return { rows: [{ value: { prefix: "OVERRIDE" } }] };
      },
    };
    const cfg = await schemeFor(c, "MOD-29", "entity-1");
    expect(cfg.prefix).toBe("OVERRIDE");
  });
  it("survives an entity lookup failure rather than breaking allocation", async () => {
    const c = {
      query: async (sql) => {
        if (/FROM corporate_entity/.test(sql)) throw new Error("relation does not exist");
        return { rows: [] };
      },
    };
    const cfg = await schemeFor(c, "MOD-29", "entity-1");
    expect(cfg.prefix).toBe("DOC");
  });
});

describe("allocate", () => {
  it("atomically increments and formats using the scheme", async () => {
    const calls = [];
    const c = { query: async (sql, params) => {
      calls.push(sql);
      if (/FROM setting/.test(sql)) return { rows: [{ value: { prefix: "SMLS", code: "INV" } }] };
      if (/INSERT INTO doc_sequence/.test(sql)) return { rows: [{ seq: 12 }] };
      return { rows: [] };
    } };
    const r = await allocate(c, { moduleKey: "MOD-51", entityId: "e1", date: "2026-02-05" });
    expect(r.seq).toBe(12);
    expect(r.year).toBe(2026);
    expect(r.number).toBe("SMLS-INV-2026-0012");
    expect(calls.some((s) => /ON CONFLICT/.test(s))).toBe(true);
  });
  it("requires an entity", async () => {
    const c = { query: async () => ({ rows: [] }) };
    await expect(allocate(c, { moduleKey: "MOD-51", date: "2026-02-05" })).rejects.toThrow(/entity/i);
  });
});
