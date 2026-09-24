/**
 * The summary draft's STATE MACHINE (PR-2, §4.10 / decision row 3), kept out of
 * the component file so the component exports only components (the Fast Refresh
 * rule) and so the guards can be tested without rendering anything.
 *
 * The guards ARE the promise, and they are the same ones the API enforces:
 *
 *   - `edit` is refused in every state that has no editor, so a posted summary
 *     cannot be quietly rewritten;
 *   - `regenerate` is PENDING_REVIEW only, and never while one is in flight;
 *   - `send` needs a sendable text and cannot start mid-rewrite;
 *   - `error` KEEPS the words — a failed send must not cost the caller the draft
 *     they just wrote.
 */
import type {
  CallProvenance,
  CallSummaryFollowUp,
  CallSummaryKeyPoint,
  CallSummaryView,
  CallTranscriptGap,
} from "@/lib/smartcomm-api";

export type DraftStatus = "waiting" | "ready" | "sending" | "sent" | "discarded" | "error";

export type DraftState = {
  status: DraftStatus;
  language: "en" | "fr";
  text: string;
  points: CallSummaryKeyPoint[];
  followUps: CallSummaryFollowUp[];
  provenance: CallProvenance;
  /** A later, better record is available and the caller may post an update. */
  updateAvailable: boolean;
  /** Stretches of the call with no transcript (named in the draft too). */
  gaps: CallTranscriptGap[];
  /** The caller changed something since the last server round-trip. */
  dirty: boolean;
  regenerating: boolean;
  /** The draft's language before a rewrite was asked for; put back if the
   *  rewrite fails, because the server refuses a rewrite into the language
   *  the draft is already in. */
  languageBefore: "en" | "fr" | null;
  error: string | null;
};

export const EMPTY: DraftState = {
  status: "waiting",
  language: "en",
  text: "",
  points: [],
  followUps: [],
  provenance: "groq",
  updateAvailable: false,
  gaps: [],
  dirty: false,
  regenerating: false,
  languageBefore: null,
  error: null,
};

export type DraftAction =
  | { type: "loaded"; view: CallSummaryView }
  | { type: "loadedSummary"; view: CallSummaryView }
  | { type: "edit"; text?: string; points?: CallSummaryKeyPoint[]; followUps?: CallSummaryFollowUp[] }
  | { type: "regenerate"; language: "en" | "fr" }
  | { type: "send" }
  | { type: "sent"; isUpdate: boolean }
  | { type: "discard" }
  | { type: "discarded" }
  | { type: "error"; message: string };

export const summaryDraftReducer = (state: DraftState, action: DraftAction): DraftState => {
  switch (action.type) {
    case "loaded": {
      const loaded = summaryDraftReducer(state, { type: "loadedSummary", view: action.view });
      return { ...loaded, gaps: action.view.gaps || [] };
    }
    case "loadedSummary": {
      const s = action.view.summary;
      if (!s) {
        // No draft yet (still transcribing, or the pipeline has not finished).
        // The panel stays open and empty rather than pretending there is
        // nothing to say — the socket event that follows fills it in.
        return { ...EMPTY, status: "waiting", language: emptyLanguage(action.view) };
      }
      if (s.draft_status === "DISCARDED") {
        return { ...EMPTY, status: "discarded", language: s.language };
      }
      if (s.draft_status === "SENT" && !s.update_available) {
        // Already posted, and the record has not improved since: there is
        // nothing to review, and the panel says so instead of offering an edit
        // the server would refuse with a 409.
        return {
          ...EMPTY,
          status: "sent",
          language: s.language,
          text: s.summary_text,
          points: s.key_points || [],
          followUps: s.follow_ups || [],
          provenance: s.provenance,
        };
      }
      return {
        ...EMPTY,
        status: "ready",
        language: s.language,
        text: s.summary_text,
        points: s.key_points || [],
        followUps: s.follow_ups || [],
        provenance: s.provenance,
        updateAvailable: s.draft_status === "SENT" && s.update_available === true,
        dirty: false,
        regenerating: false,
        error: null,
      };
    }
    case "edit": {
      // Edits are accepted in every state that still has an editor. A SENT
      // summary has none — the guard is here rather than only in the renderer
      // so the reducer cannot be talked into rewriting a sent record.
      if (state.status !== "ready" && state.status !== "error") return state;
      return {
        ...state,
        status: "ready",
        error: null,
        dirty: true,
        text: action.text ?? state.text,
        points: action.points ?? state.points,
        followUps: action.followUps ?? state.followUps,
      };
    }
    case "regenerate": {
      // PENDING_REVIEW only — the same rule the API enforces, stated here so a
      // button press cannot produce a 409 the caller has to read.
      if (state.status !== "ready" || state.regenerating) return state;
      return { ...state, regenerating: true, languageBefore: state.language, language: action.language, error: null };
    }
    case "send": {
      if (state.status !== "ready" || state.regenerating) return state;
      if (!state.text.trim()) return state;
      return { ...state, status: "sending", error: null };
    }
    case "sent":
      return { ...state, status: "sent", dirty: false, updateAvailable: false };
    case "discard":
      if (state.status !== "ready") return state;
      return { ...state, status: "sending" };
    case "discarded":
      return { ...state, status: "discarded" };
    case "error":
      // The draft is NOT lost: an error keeps the text so the caller can retry
      // rather than re-reading a summary the server may already have stored.
      // A failed rewrite puts the draft's own language back (see languageBefore).
      return {
        ...state,
        status: "error",
        regenerating: false,
        language: state.regenerating && state.languageBefore ? state.languageBefore : state.language,
        languageBefore: null,
        error: action.message,
      };
    default:
      return state;
  }
};

function emptyLanguage(view: CallSummaryView): "en" | "fr" {
  return view.summary?.language === "fr" ? "fr" : "en";
}

