"use strict";

/**
 * A DELIVERY NOTE SHOULD ASK FOR ALMOST NOTHING.
 *
 * The form used to open with an Entity dropdown listing every company in the
 * tenant, a Dossier dropdown listing bare references nobody recognises, and
 * empty boxes for the consignee, the address and the cargo — every one of which
 * the operations file already held. That is a transcription step between a
 * record and a document derived from that record, and it is exactly where the
 * two start to disagree.
 *
 * These tests pin what the file now answers, and — just as important — the two
 * places where a wrong answer would be worse than no answer:
 *
 *   · an ABSENT weight must not become "0 kg" on a proof of delivery;
 *   · an address copied from the file must be a verified place, not free text
 *     that lands in a picker and is flagged wrong underneath.
 */

const { deliveryNoteFrom, kilogrammes } = require("../../src/modules/operations/_shared/dossier-prefill");

const FILE = {
  dossier_id: "d-1",
  entity_id: "e-1",
  client_name: "BRASSERIES DU CAMEROUN SA",
  contact_name: "Aïssatou Njoya",
  contact_phone: "+237 6 99 00 11 22",
  place_delivery: "Zone Industrielle Bassa, Douala",
  commodity: "Bière",
  commodity_desc: "Cartons de bière 65cl",
  package_count: 120,
  gross_weight: 2.4,
  weight_unit: "TON",
  marks_numbers: "BRC/2026/44",
  promised_delivery_date: "2026-08-30",
};

describe("what the file answers", () => {
  test("the entity comes from the file, not from a dropdown", () => {
    // It was a <select> of every corporate entity in the tenant — a decision
    // offered for a fact the file had already settled, on a form where getting
    // it wrong puts the wrong company's letterhead on a signed document.
    const { body, from } = deliveryNoteFrom(FILE);
    expect(body.entity_id).toBe("e-1");
    expect(from).toContain("entity_id");
  });

  test("the delivery address is copied, now that it is a verified place", () => {
    // It was deliberately NOT copied, and the reason was real: `place_delivery`
    // was free text on several service types while the note's field is a
    // PlacePicker, so the copy produced a box that looked filled and carried an
    // "unverified" warning underneath. Migration 12748 makes every field bound
    // to that column a GEO_PLACE, so the value is a catalogue name and the
    // objection is gone.
    const { body, from } = deliveryNoteFrom(FILE);
    expect(body.city_zone).toBe("Zone Industrielle Bassa, Douala");
    expect(body.address).toBe("Zone Industrielle Bassa, Douala");
    expect(from).toEqual(expect.arrayContaining(["city_zone", "address"]));
  });

  test("the consignee is SUGGESTED, never stated as fact", () => {
    // A client is not a consignee — it is regularly their own buyer, a bonded
    // warehouse or a site foreman. But leaving it blank meant retyping the
    // client's name on the nine notes in ten where they are the same party. So
    // it is filled and declared, and the form shows "suggested — check it".
    const { body, inferred, from } = deliveryNoteFrom(FILE);
    expect(body.consignee).toBe("BRASSERIES DU CAMEROUN SA");
    expect(inferred).toContain("consignee");
    expect(from).not.toContain("consignee");
  });

  test("the gate contact comes from the client's primary contact", () => {
    const { body, inferred } = deliveryNoteFrom(FILE);
    expect(body.contact_person).toBe("Aïssatou Njoya");
    expect(body.phone).toBe("+237 6 99 00 11 22");
    expect(inferred).toEqual(expect.arrayContaining(["contact_person", "phone"]));
  });

  test("the delivery date is the client's PROMISE, never the carrier's ETA", () => {
    // `eta` is the carrier's guess at the port. Using it would print a delivery
    // date wrong by the length of the last mile, on a document somebody signs.
    const { body, from } = deliveryNoteFrom({ ...FILE, eta: "2026-08-01" });
    expect(body.delivery_date).toBe("2026-08-30");
    expect(from).toContain("delivery_date");
    expect(deliveryNoteFrom({ ...FILE, promised_delivery_date: null, eta: "2026-08-01" }).body.delivery_date)
      .toBeUndefined();
  });

  test("the cargo line carries what a PACKAGE note is made of", () => {
    // On a sea file the manifest identifies the goods and the line is a count.
    // On an air file the line is the whole document.
    const { body } = deliveryNoteFrom(FILE);
    expect(body.lines).toEqual([{
      label: "Cartons de bière 65cl",
      qty: 120,
      gross_weight_kg: 2400,
      marks: "BRC/2026/44",
    }]);
  });
});

describe("the answers a file must NOT invent", () => {
  test("an absent weight is absent, not zero", () => {
    // `Number(null)` is 0, so the obvious implementation prints "0 kg" on a
    // proof of delivery for a file that never recorded a weight. A wrong claim
    // about the goods is worse than a blank, and nobody would spot it.
    const { body } = deliveryNoteFrom({ ...FILE, gross_weight: null });
    expect(body.lines[0]).not.toHaveProperty("gross_weight_kg");
    expect(deliveryNoteFrom({ ...FILE, gross_weight: "" }).body.lines[0])
      .not.toHaveProperty("gross_weight_kg");
  });

  test("an absent package count is absent, not zero", () => {
    // Same trap, and it was already here before this change: a delivery note
    // for zero packages is not a thing.
    const { body } = deliveryNoteFrom({ ...FILE, package_count: null });
    expect(body.lines[0]).not.toHaveProperty("qty");
  });

  test("an unknown weight unit yields no weight at all", () => {
    // Assuming kilogrammes would be wrong by a factor of a thousand on a file
    // quoted in tonnes, and it would print as a confident number.
    expect(kilogrammes(5, "STONE")).toBeNull();
    expect(deliveryNoteFrom({ ...FILE, weight_unit: "STONE" }).body.lines[0])
      .not.toHaveProperty("gross_weight_kg");
  });

  test("every unit the file allows converts to kilogrammes", () => {
    expect(kilogrammes(2.4, "TON")).toBe(2400);
    expect(kilogrammes(500, "KG")).toBe(500);
    expect(kilogrammes(100, "LB")).toBe(45.359);
    // The unit is optional on the file; kilogrammes is the stated default.
    expect(kilogrammes(7, null)).toBe(7);
  });

  test("a file with no commodity yields no line rather than one labelled 'Cargo'", () => {
    const { body } = deliveryNoteFrom({ ...FILE, commodity: null, commodity_desc: null });
    expect(body.lines).toBeUndefined();
  });

  test("a file with nothing on it returns an empty body, not a shell of guesses", () => {
    const { body, inferred, from } = deliveryNoteFrom({ dossier_id: "d-2" });
    expect(body).toEqual({ dossier_id: "d-2" });
    expect(inferred).toEqual([]);
    expect(from).toEqual([]);
  });

  test("no dossier at all is not a crash", () => {
    expect(deliveryNoteFrom(null)).toEqual({ body: {}, inferred: [], from: [] });
  });
});
