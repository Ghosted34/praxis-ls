"use strict";
/** Party auxiliary-account code arithmetic (spec §3; PR3 §12) — pure. */
const {
  nextAuxCode,
  mirrorCodeFor,
  chooseMirrorCode,
} = require("../../src/modules/master/party-accounting.service");

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

describe("chooseMirrorCode — collision-safe allocation (PR3 §12)", () => {
  it("keeps the suffix-shared code when it is free", () => {
    expect(
      chooseMirrorCode({
        auxCode: "41110007",
        mirrorParent: "4191",
        suffixTaken: false,
        maxMirrorChild: null,
      }),
    ).toBe("41910007");
  });

  it("when the suffix collides, allocates the next child from the mirror parent's OWN sequence", () => {
    // Two parties whose aux codes share a suffix (e.g. 41110007 and an overflowed
    // 41120007 both end 0007) would both want 41910007. The second gets the
    // mirror parent's next free child instead of silently reusing the first's.
    expect(
      chooseMirrorCode({
        auxCode: "41120007",
        mirrorParent: "4191",
        suffixTaken: true,
        maxMirrorChild: "41910007",
      }),
    ).toBe("41910008");
  });

  it("falls back cleanly when the mirror parent already has unrelated children", () => {
    expect(
      chooseMirrorCode({
        auxCode: "40110003",
        mirrorParent: "4091",
        suffixTaken: true,
        maxMirrorChild: "40910042",
      }),
    ).toBe("40910043");
    // ...and starts the sequence at 0001 if somehow taken with no children yet.
    expect(
      chooseMirrorCode({
        auxCode: "40110003",
        mirrorParent: "4091",
        suffixTaken: true,
        maxMirrorChild: null,
      }),
    ).toBe("40910001");
  });
});
