"use strict";
/**
 * `dictionary_ref` CONTAINER_TYPE — creatable by a tenant, but not creatable
 * broken.
 *
 * WHY BOTH HALVES MATTER. The kind used to be rejected by the validator's enum
 * outright, so a carrier introducing a 50' box meant a deploy or raw SQL in
 * production. Opening the enum is one line; it is only SAFE because of the
 * second half. `extra` is a free-form jsonb, and a container type created with
 * an empty one is accepted by every consumer downstream and read as ZERO TEU
 * (`Number(undefined) || 0` in the dossier container editor and in the shipment
 * TEU total) with no `size` for the rate card to key on. Nothing raises, nothing
 * logs, and the tenant's capacity reporting quietly under-counts.
 *
 * So the guard belongs at the door, on create AND on update — a patch route
 * that let `extra` through unchecked would be the same hole one request later.
 */
const { schemas } = require("../../src/modules/master/financial_dictionary/financial_dictionary.validator");

const base = { kind: "CONTAINER_TYPE", code: "FT50HC", name_fr: "50' HC", name_en: "50' High Cube" };
const errPaths = (r) => r.error.issues.map((i) => i.path.join("."));

describe("dictionary_ref refCreate — container types", () => {
  test("the kind is accepted at all (it used to be rejected by the enum)", () => {
    const r = schemas.refCreate.safeParse({ ...base, extra: { teu: 2.5, size: "50HC", family: "DRY" } });
    expect(r.success).toBe(true);
    expect(r.data.extra).toEqual({ teu: 2.5, size: "50HC", family: "DRY" });
  });

  test("LOAD_MODE is accepted too, and carries no equipment requirement", () => {
    const r = schemas.refCreate.safeParse({ kind: "LOAD_MODE", code: "FCL", name_fr: "FCL" });
    expect(r.success).toBe(true);
  });

  test("a container type with no `extra` at all is refused on both fields", () => {
    const r = schemas.refCreate.safeParse(base);
    expect(r.success).toBe(false);
    expect(errPaths(r)).toEqual(expect.arrayContaining(["extra.teu", "extra.size"]));
  });

  test("TEU must be a positive number — 0, a string and a negative are all refused", () => {
    for (const teu of [0, -1, "2.5", null]) {
      const r = schemas.refCreate.safeParse({ ...base, extra: { teu, size: "50HC" } });
      expect(r.success).toBe(false);
      expect(errPaths(r)).toContain("extra.teu");
    }
  });

  test("size is required — it is the rate-card lookup key", () => {
    const r = schemas.refCreate.safeParse({ ...base, extra: { teu: 2.5 } });
    expect(r.success).toBe(false);
    expect(errPaths(r)).toContain("extra.size");
  });

  test("family is optional — the grouping falls back to OTHER, which is legible", () => {
    const r = schemas.refCreate.safeParse({ ...base, extra: { teu: 2.5, size: "50HC" } });
    expect(r.success).toBe(true);
  });

  test("the requirement is CONTAINER_TYPE-only — other kinds keep their free `extra`", () => {
    const r = schemas.refCreate.safeParse({ kind: "UNIT", code: "TON", name_fr: "Tonne" });
    expect(r.success).toBe(true);
    const scoped = schemas.refCreate.safeParse({ kind: "SUBCATEGORY", code: "PORT", name_fr: "Port", extra: { category: "debours" } });
    expect(scoped.success).toBe(true);
  });
});

describe("dictionary_ref refUpdate", () => {
  test("`extra` is patchable — a typo'd TEU was otherwise unfixable in the UI", () => {
    const r = schemas.refUpdate.safeParse({ extra: { teu: 2, size: "40HC", family: "DRY" } });
    expect(r.success).toBe(true);
    expect(r.data.extra.teu).toBe(2);
  });

  test("the existing fields still pass, and unknown keys are still stripped", () => {
    const r = schemas.refUpdate.safeParse({ name_fr: "40' HC", is_active: false, kind: "UNIT" });
    expect(r.success).toBe(true);
    expect(r.data.kind).toBeUndefined();
  });
});
