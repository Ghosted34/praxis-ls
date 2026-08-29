/**
 * What POST /mail/send accepts as a recipient list.
 *
 * ── The incident this pins ──────────────────────────────────────────────────
 *
 * `VALIDATION_ERROR: bcc, cc`, tenant smartls, production. `cc` and `bcc`
 * accepted an array of already-bare addresses and nothing else, so every
 * ordinary thing a person does in a copy field was a 422 — a row with two
 * addresses in it, an address pasted with the name in front of it, a copy row
 * opened and then cleared. And the whole of what the operator was told was
 * "Invalid body": the offending address was never in the message, and the
 * fields list was `["cc"]`.
 *
 * So there are two things under test here, and the second matters as much as
 * the first:
 *
 *   1. the parse — what a recipient list may look like on the way in;
 *   2. the refusal — an address that is not one is refused BY NAME, in a
 *      sentence the composer can put next to the field.
 */
"use strict";

const v = require("../../src/modules/mail/mail/mail.validator");

const CONN = "11111111-1111-4111-8111-111111111111";
const send = (body) => v.schemas.send.safeParse({ connectionId: CONN, to: ["a@b.cm"], ...body });

/** The middleware's answer, as the route would produce it. */
const reject = (schema, body) => new Promise((resolve) => {
  v[schema]({ body }, {}, (err) => resolve(err));
});

describe("a recipient list, as people actually write one", () => {
  test("TWO ADDRESSES IN ONE FIELD ARE TWO RECIPIENTS", () => {
    // The reported bug: the Cc row is one text field, and the comma in it was
    // the entire mechanism for a second address.
    const r = send({ cc: "ops@camrail.cm, billing@camrail.cm" });
    expect(r.success).toBe(true);
    expect(r.data.cc).toEqual(["ops@camrail.cm", "billing@camrail.cm"]);
  });

  test("a semicolon separates too — Outlook trained half the country on it", () => {
    expect(send({ cc: "a@b.cm; c@d.cm" }).data.cc).toEqual(["a@b.cm", "c@d.cm"]);
  });

  test("a display name is a name in front of an address, not a bad address", () => {
    expect(send({ cc: ["Jean Dupont <jean@acme.cm>"] }).data.cc).toEqual(["jean@acme.cm"]);
  });

  test("A COMMA INSIDE A QUOTED NAME IS NOT A SEPARATOR", () => {
    // Splitting on every comma turns one recipient into two broken ones.
    expect(send({ cc: ['"Dupont, Jean" <j@acme.cm>, x@y.cm'] }).data.cc)
      .toEqual(["j@acme.cm", "x@y.cm"]);
  });

  test("A SPACE BETWEEN TWO ADDRESSES SEPARATES THEM TOO", () => {
    // The likeliest shape behind the production notice: a Cc field with no
    // visible way to add a second address, and two typed into it anyway.
    expect(send({ cc: "ops@camrail.cm billing@camrail.cm" }).data.cc)
      .toEqual(["ops@camrail.cm", "billing@camrail.cm"]);
  });

  test("but a name with a space in it is one bad recipient, not two", () => {
    // `Jean Dupont` is somebody who forgot to type an address. Splitting it
    // would refuse `Jean` and `Dupont` separately and explain neither.
    const r = send({ cc: "Jean Dupont" });
    expect(r.success).toBe(false);
    expect(r.error.flatten().fieldErrors.cc).toEqual(['"Jean Dupont" is not an email address']);
  });

  test("and a display name keeps its spaces", () => {
    expect(send({ cc: "Jean Dupont <jean@acme.cm>" }).data.cc).toEqual(["jean@acme.cm"]);
    // Two of them still need the separator between them that a mail client
    // writes. `A <a@b.cm> B <c@d.cm>` with nothing between the two is genuinely
    // ambiguous, and guessing at it is how one recipient becomes three; it is
    // refused, by name, rather than silently taken apart.
    expect(send({ cc: "Jean <jean@acme.cm>, Marie <marie@acme.cm>" }).data.cc)
      .toEqual(["jean@acme.cm", "marie@acme.cm"]);
  });

  test("a single address may still arrive as a string", () => {
    expect(send({ to: "solo@acme.cm" }).data.to).toEqual(["solo@acme.cm"]);
  });

  test("a cleared copy row is a request to copy nobody, not a malformed body", () => {
    const r = send({ cc: null, bcc: "" });
    expect(r.success).toBe(true);
    expect(r.data.cc).toEqual([]);
    expect(r.data.bcc).toEqual([]);
  });

  test("a trailing separator is not an empty recipient", () => {
    expect(send({ cc: ["a@b.cm", ""] }).data.cc).toEqual(["a@b.cm"]);
  });

  test("THE SAME PERSON TWICE IS ONE RECIPIENT", () => {
    // Case-insensitively, and keeping the first spelling — the alternative is
    // a counterparty receiving the same message twice.
    expect(send({ cc: ["ops@camrail.cm", "OPS@camrail.cm"] }).data.cc).toEqual(["ops@camrail.cm"]);
  });

  test("the cap is still a cap", () => {
    const many = Array.from({ length: 101 }, (_, i) => `a${i}@b.cm`);
    expect(send({ cc: many }).success).toBe(false);
  });
});

describe("an address that is not one", () => {
  test("IS REFUSED BY NAME, not by field", async () => {
    const err = await reject("send", { connectionId: CONN, to: ["a@b.cm"], cc: ["jean dupont"] });
    expect(err.status).toBe(422);
    expect(err.message).toBe('Cc: "jean dupont" is not an email address');
    expect(err.details.cc).toEqual(['"jean dupont" is not an email address']);
  });

  test("a send with no recipient says what to do about it", async () => {
    const err = await reject("send", { connectionId: CONN, to: [] });
    expect(err.message).toBe("To: Add at least one recipient.");
  });

  test("the message is never the old 'Invalid body' again", async () => {
    const err = await reject("send", { connectionId: "not-a-uuid", to: ["a@b.cm"] });
    expect(err.message).not.toBe("Invalid body");
    expect(err.message).toMatch(/connectionId/);
  });
});

describe("a draft is a work in progress and is parsed as one", () => {
  test("half an address is saved, not refused", () => {
    const r = v.schemas.draft.safeParse({ cc_address: "a@b.cm, jean" });
    expect(r.success).toBe(true);
    expect(r.data.cc_address).toEqual(["a@b.cm", "jean"]);
  });

  test("clearing a row on a draft clears it", () => {
    expect(v.schemas.draft.safeParse({ bcc_address: null }).data.bcc_address).toEqual([]);
  });
});
