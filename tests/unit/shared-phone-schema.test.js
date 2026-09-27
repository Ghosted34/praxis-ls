/**
 * 16 Sep review, M3-B29 — an entity phone typed with spaces ("+237 6 90 00 00
 * 00") was refused with "Enter a phone number in international format", and
 * the form's own placeholder showed the number with spaces.
 *
 * The shared `phone` schema now normalises separators before the E.164 rule
 * and stores the canonical form. These rules pin both halves: what is
 * accepted (and what it becomes), and what is still refused — the digit rule
 * did not get looser, only the punctuation around it did.
 */
"use strict";

const { common } = require("@praxis/shared");

const parse = (v) => common.phone.safeParse(v);

describe("shared phone schema — separators are presentation, not data", () => {
  test.each([
    ["+237 6 90 00 00 00", "+237690000000"],
    ["+237-690-000-000", "+237690000000"],
    ["(+237) 690.000.000", "+237690000000"],
    ["+237\u00a0690 000 000", "+237690000000"], // non-breaking space from a PDF
    ["  +237690000000  ", "+237690000000"],
    ["00237 690 000 000", "+237690000000"], // landline dialling prefix → +
    ["690000000", "690000000"], // national form still passes the digit rule
  ])("%s → %s", (input, stored) => {
    const r = parse(input);
    expect(r.success).toBe(true);
    expect(r.data).toBe(stored);
  });

  test.each([
    "12 345", // too short even once the space is gone
    "+237 69O 000 000", // a letter O, not a zero
    "+237 690 000 000 ext 12",
    "++237690000000",
    "+237#690000000",
    "+0237690000000", // leading zero after +
    "+2376900000001234567", // 19 digits
  ])("still refuses %s", (input) => {
    const r = parse(input);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/international format/);
  });

  test("blank stays undefined, and a non-string is a type error not a phone error", () => {
    expect(parse("").data).toBeUndefined();
    expect(parse(undefined).data).toBeUndefined();
    const r = parse(237690000000);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).not.toMatch(/international format/);
  });

  test("normalizePhone is exported for forms that want to show the stored shape on blur", () => {
    expect(common.normalizePhone("+237 6 90 00 00 00")).toBe("+237690000000");
    expect(common.normalizePhone(null)).toBeNull();
  });
});
