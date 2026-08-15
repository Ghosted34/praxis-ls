"use strict";
/**
 * Data URLs as browsers actually write them.
 *
 * WHAT BROKE. Two call sites hand-rolled `/^data:([^;]+);base64,(.+)$/`, which
 * cannot cross a parameter in the media type. `MediaRecorder` always produces
 * one — `audio/webm;codecs=opus` — so every recording the voice button made was
 * refused with "Expected a base64 audio data URL": a message that blames the
 * browser for sending exactly what RFC 2397 §3 says it may send. The upload path
 * carried the same bug latent, hidden only because a file picked from disk
 * usually reports a bare `application/pdf`.
 */

const { parseDataUrl } = require("../../src/utils/data-url");

const b64 = (s) => Buffer.from(s).toString("base64");

describe("parseDataUrl", () => {
  it("reads a plain media type", () => {
    const out = parseDataUrl(`data:application/pdf;base64,${b64("hello")}`);
    expect(out.mimeType).toBe("application/pdf");
    expect(out.buffer.toString()).toBe("hello");
    expect(out.params).toEqual([]);
  });

  it("reads the one the voice button actually sends", () => {
    // The exact shape MediaRecorder + FileReader produce, and the exact input
    // that used to fail.
    const out = parseDataUrl(`data:audio/webm;codecs=opus;base64,${b64("clip")}`);
    expect(out.mimeType).toBe("audio/webm");
    expect(out.params).toEqual(["codecs=opus"]);
    expect(out.buffer.toString()).toBe("clip");
  });

  it("strips parameters from the type an allow-list compares against", () => {
    // `audio/webm` and `audio/webm;codecs=opus` are the same format, and no
    // allow-list should have to enumerate codec spellings.
    const out = parseDataUrl(`data:image/jpeg;charset=binary;base64,${b64("x")}`);
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("lower-cases the type, because allow-lists are lower-case", () => {
    expect(parseDataUrl(`data:APPLICATION/PDF;base64,${b64("x")}`).mimeType).toBe(
      "application/pdf",
    );
  });

  it("returns null for anything that is not a base64 data URL", () => {
    expect(parseDataUrl("")).toBeNull();
    expect(parseDataUrl(null)).toBeNull();
    expect(parseDataUrl("https://example.com/a.pdf")).toBeNull();
    // URL-encoded rather than base64: real, and not something callers here can
    // decode as bytes, so it is a refusal rather than a silent mis-read.
    expect(parseDataUrl("data:text/plain,hello")).toBeNull();
  });

  it("reports an empty payload as an empty buffer, not as a parse failure", () => {
    // The callers each have their own message for "nothing was recorded" /
    // "file is empty", and they can only reach it if parsing succeeds.
    const out = parseDataUrl("data:audio/webm;base64,");
    expect(out).not.toBeNull();
    expect(out.buffer.length).toBe(0);
  });
});
