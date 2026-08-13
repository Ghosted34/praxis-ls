"use strict";
const { z } = require("zod");
const registrar = require("../../src/services/ai/action-registrar");

describe("AI action registrar", () => {
  const cat = registrar.buildCatalogue();

  test("derives a non-trivial catalogue from manifests, unique keys", () => {
    expect(cat.length).toBeGreaterThan(50);
    const keys = cat.map((r) => r.action_key);
    expect(new Set(keys).size).toBe(keys.length); // no duplicates
  });

  test("reads are ai_enabled + no-confirm; writes carry permission + confirm", () => {
    const reads = cat.filter((r) => !r.is_write);
    const writes = cat.filter((r) => r.is_write);
    expect(reads.every((r) => r.ai_enabled === true)).toBe(true);
    expect(reads.every((r) => r.requires_confirmation === false)).toBe(true);
    // every write action names a permission "MOD-xx:action"
    expect(
      writes.every((r) =>
        /^MOD-\d+:(create|edit|approve|view|delete)$/.test(
          r.required_permission || "",
        ),
      ),
    ).toBe(true);
    expect(writes.every((r) => r.requires_confirmation === true)).toBe(true);
  });

  test("every ai_enabled write has a runnable executor (no drift)", () => {
    // The write boundary is open (generic writeAdapter backs every manifest write,
    // vetted registry wins where present), so the invariant is one-directional:
    // anything ADVERTISED must be runnable — never advertise a write we can't run.
    const map = registrar.buildExecutorMap();
    for (const w of cat.filter((r) => r.is_write && r.ai_enabled)) {
      expect(typeof map[w.action_key]).toBe("function");
    }
  });

  test("executor map has every read + the registry writes", () => {
    const map = registrar.buildExecutorMap();
    const reads = cat.filter((r) => !r.is_write);
    for (const r of reads) expect(typeof map[r.action_key]).toBe("function");
  });

  test("zodToJsonSchema derives top-level shape + required", () => {
    const schema = z.object({
      entity_id: z.string().uuid(),
      amount: z.number().positive(),
      note: z.string().optional(),
      kind: z.enum(["A", "B"]),
    });
    const js = registrar.zodToJsonSchema(schema);
    expect(js.type).toBe("object");
    expect(js.properties.entity_id.type).toBe("string");
    expect(js.properties.amount.type).toBe("number");
    expect(js.properties.kind.enum).toEqual(["A", "B"]);
    expect(js.required).toContain("entity_id");
    expect(js.required).not.toContain("note"); // optional
  });
});
