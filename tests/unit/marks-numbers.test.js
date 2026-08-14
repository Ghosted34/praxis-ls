"use strict";
/**
 * Marks & Numbers — the format legacy printed, recovered exactly.
 *
 * WHY THE ASSERTIONS ARE BYTE-LEVEL. The string this produces is read by the
 * final invoice (`printfi.php:602`), the transit order, the delivery note and
 * both costing packages. A "tidier" separator, an unpadded quantity or a token
 * legacy never emitted means a file created today prints differently from the
 * same shipment filed last year — on documents that go to customs and to the
 * client. So the tests pin the bytes, not the shape.
 */
const { marks } = require("@praxis/shared");

/** The registry rows, as `dictionary_ref` holds them. */
const TYPES = {
  rf20: {
    code: "RF20",
    extra: { teu: 1, size: "20", family: "REEFER", marks_token: "20'RF" },
  },
  hc40: {
    code: "FT40HC",
    extra: { teu: 2, size: "40HC", family: "DRY", marks_token: "40'HC" },
  },
  dry20: {
    code: "FT20",
    extra: { teu: 1, size: "20", family: "DRY", marks_token: "20'DC" },
  },
  // A tenant-created type: no token, so it has to be derived.
  new50: { code: "FT50HC", extra: { teu: 2.5, size: "50HC", family: "DRY" } },
};

describe("marks & numbers — the legacy format", () => {
  it("prints the brief's example exactly", () => {
    const s = marks.marksFromContainers(
      [
        { qty: 1, container_type_ref_id: "rf20" },
        { qty: 2, container_type_ref_id: "hc40" },
      ],
      TYPES,
    );
    expect(s).toBe("01*20'RF, 02*40'HC");
  });

  it("zero-pads to two digits and stops there", () => {
    expect(
      marks.marksFromContainers(
        [{ qty: 1, container_type_ref_id: "dry20" }],
        TYPES,
      ),
    ).toBe("01*20'DC");
    expect(
      marks.marksFromContainers(
        [{ qty: 12, container_type_ref_id: "dry20" }],
        TYPES,
      ),
    ).toBe("12*20'DC");
    // 100 boxes is `100`, not `00` — padStart never truncates, and a silently
    // truncated quantity on a bill of lading is a customs problem.
    expect(
      marks.marksFromContainers(
        [{ qty: 100, container_type_ref_id: "dry20" }],
        TYPES,
      ),
    ).toBe("100*20'DC");
  });

  it("keeps the operator's line order rather than sorting", () => {
    const s = marks.marksFromContainers(
      [
        { qty: 2, container_type_ref_id: "hc40" },
        { qty: 1, container_type_ref_id: "rf20" },
      ],
      TYPES,
    );
    expect(s).toBe("02*40'HC, 01*20'RF");
  });

  it("skips lines with no quantity or no type, and returns empty for nothing", () => {
    expect(marks.marksFromContainers([], TYPES)).toBe("");
    expect(marks.marksFromContainers(null, TYPES)).toBe("");
    expect(
      marks.marksFromContainers(
        [
          { qty: 0, container_type_ref_id: "rf20" },
          { qty: 3, container_type_ref_id: null },
          { qty: 2, container_type_ref_id: "hc40" },
        ],
        TYPES,
      ),
    ).toBe("02*40'HC");
  });

  it("takes a Map as readily as an object — the server holds one", () => {
    const m = new Map(Object.entries(TYPES));
    expect(
      marks.marksFromContainers([{ qty: 1, container_type_ref_id: "rf20" }], m),
    ).toBe("01*20'RF");
  });
});

describe("marks & numbers — the token for one type", () => {
  it("uses the registry's own token when it has one", () => {
    expect(marks.marksTokenFor(TYPES.hc40)).toBe("40'HC");
  });

  it("derives one for a tenant-created type, treating HC as a type not a size", () => {
    expect(marks.marksTokenFor(TYPES.new50)).toBe("50'HC");
    expect(marks.marksTokenFor({ extra: { size: "20", family: "DRY" } })).toBe(
      "20'DC",
    );
    expect(
      marks.marksTokenFor({ extra: { size: "45HC", family: "DRY" } }),
    ).toBe("45'HC");
  });

  it("maps each family onto legacy's type code", () => {
    const t = (family, size = "40") =>
      marks.marksTokenFor({ extra: { size, family } });
    expect(t("REEFER")).toBe("40'RF");
    expect(t("FLATRACK")).toBe("40'FR");
    expect(t("OPENTOP")).toBe("40'OT");
    expect(t("ISOTANK")).toBe("40'TK");
    expect(t("VENTILATED")).toBe("40'VT");
    expect(t("BULK")).toBe("40'BU");
  });

  /*
   * Legacy's five type codes cannot say "high cube" AND "reefer" at once, so a
   * 40' HC reefer prints as a 40' reefer. Deliberate — see 0668's header. The
   * escape hatch is the per-type token, which is why this is a registry value.
   */
  it("collapses a high-cube reefer onto the reefer token", () => {
    expect(
      marks.marksTokenFor({ extra: { size: "40HC", family: "REEFER" } }),
    ).toBe("40'RF");
  });

  it("never returns an empty token", () => {
    // The size-less legacy rows: the bare type code.
    expect(
      marks.marksTokenFor({ code: "FLATRACK", extra: { family: "FLATRACK" } }),
    ).toBe("FR");
    // Nothing at all still prints something rather than `01*`.
    expect(marks.marksTokenFor({ code: "MYSTERY" })).toBe("DC");
    expect(marks.marksTokenFor({})).toBeTruthy();
  });
});
