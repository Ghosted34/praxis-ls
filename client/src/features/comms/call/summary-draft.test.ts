/**
 * The summary draft's state machine (PR-2, §4.10 / decision row 3).
 *
 * These are the guards the caller's screen cannot be talked out of: a sent
 * summary has no editor, a regeneration is not offered on a posted draft, a
 * failed send keeps the text, and an un-sendable edit is refused before the API
 * has to say 422.
 */
import { describe, it, expect } from "vitest";
import { summaryDraftReducer, type DraftState } from "./summary-draft-state";
import type { CallSummaryView } from "@/lib/smartcomm-api";

const view = (over: Partial<CallSummaryView> = {}, summary: Partial<CallSummaryView["summary"]> = {}): CallSummaryView => ({
  call_id: "c1",
  transcription_state: "CERTIFIED",
  transcription_error: null,
  recording_enabled: true,
  is_caller: true,
  summary: over.summary === null ? null : {
    summary_id: "s1",
    summary_text: "Draft prose.",
    key_points: [{ text: "Livraison confirmée", raised_by: "caller" }],
    follow_ups: [{ text: "Envoyer le BL", owner: "caller", due: "2026-09-30" }],
    language: "en",
    provenance: "groq",
    draft_status: "PENDING_REVIEW",
    sent_message_id: null,
    update_available: false,
    update_message_id: null,
    regenerate_count: 0,
    ...summary,
  },
  ...over,
}) as CallSummaryView;

const loaded = (v: CallSummaryView = view()) => summaryDraftReducer(
  { status: "waiting", language: "en", text: "", points: [], followUps: [], provenance: "groq", updateAvailable: false, dirty: false, regenerating: false, error: null },
  { type: "loaded", view: v },
);

describe("loading a draft", () => {
  it("a PENDING_REVIEW draft is editable, with the quotations as they were spoken", () => {
    const s = loaded();
    expect(s.status).toBe("ready");
    expect(s.text).toBe("Draft prose.");
    expect(s.dirty).toBe(false);
    // VERBATIM: the French key point stays French under an English draft.
    expect(s.points).toEqual([{ text: "Livraison confirmée", raised_by: "caller" }]);
  });

  it("a summary that has already been sent has no editor unless the record improved", () => {
    expect(loaded(view({}, { draft_status: "SENT" })).status).toBe("sent");
    const offered = loaded(view({}, { draft_status: "SENT", update_available: true }));
    expect(offered.status).toBe("ready");
    expect(offered.updateAvailable).toBe(true);
  });

  it("a discarded draft stays discarded", () => {
    expect(loaded(view({}, { draft_status: "DISCARDED" })).status).toBe("discarded");
  });

  it("no draft yet (still transcribing) waits rather than inventing one", () => {
    const s = loaded(view({ summary: null }));
    expect(s.status).toBe("waiting");
    expect(s.text).toBe("");
  });
});

describe("editing and regenerating", () => {
  it("an edit is kept, and a regeneration replaces the prose in the other language", () => {
    let s = loaded();
    s = summaryDraftReducer(s, { type: "edit", text: "My own words." });
    expect(s.dirty).toBe(true);

    s = summaryDraftReducer(s, { type: "regenerate", language: "fr" });
    expect(s.regenerating).toBe(true);

    s = summaryDraftReducer(s, {
      type: "regenerated",
      payload: {
        language: "fr",
        provenance: "groq",
        summary: {
          summary_text: "Le résumé en français.",
          key_points: [{ text: "Livraison confirmée", raised_by: "caller" }],
          follow_ups: [],
        },
      },
    });
    expect(s.language).toBe("fr");
    expect(s.text).toBe("Le résumé en français.");
    expect(s.regenerating).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it("a regeneration is refused while one is already running", () => {
    let s = loaded();
    s = summaryDraftReducer(s, { type: "regenerate", language: "fr" });
    const again = summaryDraftReducer(s, { type: "regenerate", language: "en" });
    expect(again.language).toBe("fr");
    expect(again.regenerating).toBe(true);
  });

  it("a sent summary cannot be edited back into an editor", () => {
    const sent = loaded(view({}, { draft_status: "SENT" }));
    const after = summaryDraftReducer(sent, { type: "edit", text: "rewrite the record" });
    expect(after.status).toBe("sent");
    expect(after.text).toBe("Draft prose.");
  });
});

describe("sending", () => {
  it("sends once, and the button state reflects it", () => {
    let s = loaded();
    s = summaryDraftReducer(s, { type: "send" });
    expect(s.status).toBe("sending");
    s = summaryDraftReducer(s, { type: "sent", isUpdate: false });
    expect(s.status).toBe("sent");
    // A second send is not a state transition — there is no auto-post path and
    // no second post of a summary that is already in the conversation.
    expect(summaryDraftReducer(s, { type: "send" }).status).toBe("sent");
  });

  it("an emptied draft is not sendable", () => {
    let s = loaded();
    s = summaryDraftReducer(s, { type: "edit", text: "   " });
    expect(summaryDraftReducer(s, { type: "send" }).status).toBe("ready");
  });

  it("a send cannot start while a rewrite is in flight", () => {
    let s = loaded();
    s = summaryDraftReducer(s, { type: "regenerate", language: "fr" });
    expect(summaryDraftReducer(s, { type: "send" }).status).toBe("ready");
  });

  it("a failure keeps the words, so the caller can retry", () => {
    let s: DraftState = loaded();
    s = summaryDraftReducer(s, { type: "edit", text: "My edited draft." });
    s = summaryDraftReducer(s, { type: "send" });
    s = summaryDraftReducer(s, { type: "error", message: "Could not send the summary. Try again." });
    expect(s.status).toBe("error");
    expect(s.text).toBe("My edited draft.");
    expect(s.error).toMatch(/try again/i);
  });

  it("discarding is not available on a draft that was already posted", () => {
    const sent = loaded(view({}, { draft_status: "SENT" }));
    expect(summaryDraftReducer(sent, { type: "discard" }).status).toBe("sent");
  });
});
