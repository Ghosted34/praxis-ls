"use strict";
/**
 * Delivery-note prefill (10708) — grouped container lines and the
 * `already_on` flag.
 *
 * ── WHAT BROKE, AND WHAT THESE PROTECT ─────────────────────────────────────
 *
 * `deliveryNoteFrom` read only `dossier_container_unit` rows. A file in
 * GROUPED mode — the default for containerised service types — states its
 * equipment as container LINES ("3 × 40' HC") and has no units at all, so the
 * prefill offered NOTHING from exactly the files the delivery note exists to
 * serve. 10708 makes the line a first-class container shape on the note.
 *
 * The second property: a unit already covered by another note is flagged, not
 * silently re-offered. The prefill must carry `already_on` so the form can
 * skip twice-delivered boxes while the picker still shows them for a
 * deliberate split load.
 */

const prefill = require("../../src/modules/operations/_shared/dossier-prefill");
const rules = require("../../src/modules/operations/delivery_note/delivery_note.rules");

const DOSSIER = {
  dossier_id: "00000000-0000-4000-8000-000000000001",
  entity_id: "00000000-0000-4000-8000-000000000002",
  commodity: "Bagged rice",
  package_count: 420,
};

const LINE_ID = "00000000-0000-4000-8000-00000000000a";
const UNIT_A = "00000000-0000-4000-8000-00000000000b";
const UNIT_B = "00000000-0000-4000-8000-00000000000c";

describe("deliveryNoteFrom — grouped files", () => {
  it("prefills a GROUPED container line the way the file states it", () => {
    const { body } = prefill.deliveryNoteFrom(
      DOSSIER,
      [],
      [
        {
          dossier_container_line_id: LINE_ID,
          container_type_code: "40HC",
          container_type_en: "40' High Cube",
          qty: 3,
        },
      ],
    );

    expect(body.containers).toHaveLength(1);
    expect(body.containers[0]).toMatchObject({
      dossier_container_line_id: LINE_ID,
      container_type_code: "40HC",
      qty: 3,
      container_no: null,
    });
  });

  it("still prefills the cargo line from the file's commodity", () => {
    const { body, from } = prefill.deliveryNoteFrom(
      DOSSIER,
      [],
      [{ dossier_container_line_id: LINE_ID, container_type_code: "40HC", qty: 2 }],
    );

    expect(body.lines).toEqual([{ label: "Bagged rice", qty: 420 }]);
    expect(from).toEqual(expect.arrayContaining(["lines", "containers"]));
  });

  it("offers BOTH the grouped line and the per-box units of a mixed file", () => {
    const { body } = prefill.deliveryNoteFrom(
      DOSSIER,
      [
        { dossier_container_unit_id: UNIT_A, container_no: "MSKU1234567", seal_no: "S1", gross_weight_kg: 12000 },
        { dossier_container_unit_id: UNIT_B, container_no: "MSKU7654321", seal_no: "S2", gross_weight_kg: 12100 },
      ],
      [{ dossier_container_line_id: LINE_ID, container_type_code: "20GP", qty: 1 }],
    );

    expect(body.containers).toHaveLength(3);
    const line = body.containers.find((c) => c.dossier_container_line_id);
    expect(line).toMatchObject({ container_type_code: "20GP", qty: 1 });
    const units = body.containers.filter((c) => c.dossier_container_unit_id);
    expect(units.map((u) => u.container_no).sort()).toEqual(["MSKU1234567", "MSKU7654321"]);
  });

  it("carries `already_on` so the form can skip boxes another note covers", () => {
    const { body } = prefill.deliveryNoteFrom(
      DOSSIER,
      [
        { dossier_container_unit_id: UNIT_A, container_no: "MSKU1234567", already_on: ["DN-2026-0007"] },
        { dossier_container_unit_id: UNIT_B, container_no: "MSKU7654321", already_on: [] },
      ],
      [],
    );

    expect(body.containers.find((c) => c.dossier_container_unit_id === UNIT_A).already_on).toEqual(["DN-2026-0007"]);
    expect(body.containers.find((c) => c.dossier_container_unit_id === UNIT_B).already_on).toEqual([]);
  });

  it("prefills nothing when the file has neither units nor lines", () => {
    const { body } = prefill.deliveryNoteFrom(DOSSIER, [], []);
    expect(body.containers).toBeUndefined();
    expect(body.dossier_id).toBe(DOSSIER.dossier_id);
  });
});

describe("normaliseContainers — the grouped shape", () => {
  it("accepts a container line with a type code and a quantity", () => {
    const rows = rules.normaliseContainers([
      { dossier_container_line_id: LINE_ID, container_type_code: "40HC", qty: 3 },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        dossier_container_line_id: LINE_ID,
        container_type_code: "40HC",
        qty: 3,
        container_no: null,
      }),
    ]);
  });

  it("still refuses a row with no unit, no line and no number", () => {
    expect(() => rules.normaliseContainers([{ seal_no: "S1" }])).toThrow(/needs a number/);
  });

  it("deduplicates a line picked twice", () => {
    const rows = rules.normaliseContainers([
      { dossier_container_line_id: LINE_ID, qty: 2 },
      { dossier_container_line_id: LINE_ID, qty: 2 },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("clamps nonsense quantities to a whole number of at least one", () => {
    const rows = rules.normaliseContainers([
      { dossier_container_line_id: LINE_ID, qty: 0 },
      { dossier_container_line_id: LINE_ID + "1", qty: 2.7 },
    ]);
    expect(rows[0].qty).toBe(1);
    expect(rows[1].qty).toBe(2);
  });
});
