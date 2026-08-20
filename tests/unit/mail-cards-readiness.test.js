"use strict";

const { readinessFrom } = require("../../src/modules/mail/binding/cards");

describe("card readiness is honest", () => {
  test("missing incoterm is named, not defaulted", () => {
    const r = readinessFrom({ client_id: "c1" }, "proforma");
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.field)).toEqual(expect.arrayContaining(["incoterm", "delivery_place"]));
    expect(r.prefill.incoterm).toBeUndefined();
  });

  test("ready only when every field is present", () => {
    const r = readinessFrom({ client_id: "c1", incoterm: "FOB", delivery_place: "Douala" }, "proforma");
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.target).toMatch(/proforma/);
  });
});
