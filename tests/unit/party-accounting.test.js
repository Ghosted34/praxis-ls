"use strict";
/** Party auxiliary-account code arithmetic (spec §3) — pure. */
const { nextAuxCode, mirrorCodeFor } = require("../../src/modules/master/party-accounting.service");

describe("nextAuxCode", () => {
  it("starts the sequence at <parent>0001 when there are no children", () => {
    expect(nextAuxCode("4111", null)).toBe("41110001");
    expect(nextAuxCode("4011", null)).toBe("40110001");
  });
  it("increments the current maximum by one", () => {
    expect(nextAuxCode("4111", "41110007")).toBe("41110008");
    expect(nextAuxCode("4011", "40110009")).toBe("40110010");
  });
});

describe("mirrorCodeFor", () => {
  it("shares the aux suffix under the mirror control account", () => {
    expect(mirrorCodeFor("41110007", "4191")).toBe("41910007"); // client advances received
    expect(mirrorCodeFor("40110003", "4091")).toBe("40910003"); // supplier advances paid
    expect(mirrorCodeFor("40110003", "4474")).toBe("44740003"); // supplier WHT
  });
});
