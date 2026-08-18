"use strict";
/**
 * Live dictation and the minutes it feeds (10708).
 *
 * ── WHAT THESE PROTECT ─────────────────────────────────────────────────────
 *
 * The transcript is SOURCE material, exactly like the typed notes: it goes
 * into the prompt as the model's only input and is never invented by the
 * model. The pure functions behind that — `sourceText` and `promptMessages` —
 * are exercised here, since they are the seam where a transcript could be
 * dropped, doubled, or given to the model as its own output.
 */

const minutes = require("../../src/modules/hr/training/training.minutes");

describe("sourceText", () => {
  it("folds the transcript in as the last, largest block", () => {
    const source = minutes.sourceText({
      notes: [{ is_minutes: true, body: "Covered PPE." }],
      transcript: "Good morning everyone. Today we cover PPE.",
    });

    expect(source).toContain("## Minutes taken during the session");
    expect(source).toContain("## Transcript");
    expect(source.indexOf("## Transcript")).toBeGreaterThan(source.indexOf("PPE."));
  });

  it("counts the transcript towards whether there is enough to summarise", () => {
    // 60 characters of notes — under MIN_SOURCE_CHARS on their own — plus a
    // transcript that pushes the combined source over the threshold.
    const longTranscript = "word ".repeat(80); // 400 chars
    const source = minutes.sourceText({ notes: [{ body: "short" }], transcript: longTranscript });
    expect(source.length).toBeGreaterThan(minutes.MIN_SOURCE_CHARS);
  });

  it("returns an empty source for a session with nothing captured at all", () => {
    expect(minutes.sourceText({ notes: [], transcript: null })).toBe("");
  });
});

describe("promptMessages", () => {
  it("hands the transcript to the model inside the captured material", () => {
    const messages = minutes.promptMessages(
      { title: "Forklift safety" },
      "## Transcript\nOperators must check the horn before moving.",
    );

    const user = messages.find((m) => m.role === "user");
    expect(user.content).toContain("Operators must check the horn before moving.");
    // The transcript travels as INPUT, never as part of the instructions.
    const system = messages.find((m) => m.role === "system");
    expect(system.content).not.toContain("Operators must check the horn");
  });
});
