"use strict";
/**
 * The call summary contract (doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md §4.10).
 *
 * ── WHY THIS IS SHARED AND NOT DECLARED TWICE ──────────────────────────────
 *
 * The API parses the LLM's JSON with this, and the caller's screen renders the
 * draft the API stored with it. Two copies of "what a summary is" is the
 * failure the whole package exists to prevent, and here it has a sharp edge:
 * the client EDITS the draft before sending it back, so a shape the client
 * believes is legal and the API refuses would be a draft that cannot be sent —
 * after the call, by the person who just had it.
 *
 * ── THE LANGUAGE RULE, EXPRESSED AS A SHAPE (§4.10) ────────────────────────
 *
 * `summary` is connective prose and is drafted in the CALLER'S app language
 * (the draft language, switchable with one tap on the regenerate endpoint).
 * `key_points[].text` and `follow_ups[].text` are VERBATIM quotations from a
 * certified, auditable channel: they stay in the language spoken, and nothing
 * in this schema — or anywhere downstream — translates or re-words them.
 * Silently rewriting a business statement is precisely what this codebase's
 * message certification exists to prevent.
 *
 * A consequence worth stating: NOTHING here declares "one language for the
 * document". A code-switched call legitimately produces French key points
 * under an English summary, and that is the contract working, not a bug.
 *
 * ── LIMITS ARE PART OF THE CONTRACT ────────────────────────────────────────
 *
 * A model that returns forty key points has produced something nobody will
 * read, and a 4,000-character "summary" is a transcript with extra steps. The
 * bounds are enforced by `sanitise()` rather than by rejecting the answer:
 * a draft that is too long is still a useful draft once it is trimmed, and
 * failing the whole pipeline over a chatty model would throw away the
 * transcript's only reader. `schema` stays strict for callers that want the
 * hard answer — the caller's own EDIT is validated with it, because an edit
 * that violates the contract is a client bug worth a 422.
 */

const { z } = require("zod");

/** The two languages of the corridor (D6). No free-text language field. */
const LANGUAGES = /** @type {const} */ (["en", "fr"]);

/** The bounds. Exported so a form can state them before the user hits them. */
const LIMITS = {
  summaryMax: 1200,
  pointsMax: 10,
  followUpsMax: 10,
  textMax: 500,
};

const language = z.enum(LANGUAGES);

/** Which speaker a point or an action belongs to — the two sides of a 1:1. */
const speaker = z.enum(["caller", "callee"]);

/**
 * `YYYY-MM-DD`, nullable — a follow-up frequently has no date, and `null` is
 * how "no date" is said. Round-trip validated, so 31 February is not a date:
 * `new Date("2026-02-31")` rolls over to 3 March and reports success.
 */
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That date doesn't exist.")
  .nullable();

const keyPoint = z.object({
  /** Verbatim, in the language it was spoken. Never translated. */
  text: z.string().trim().min(1).max(LIMITS.textMax),
  raised_by: speaker,
});

const followUp = z.object({
  /** Verbatim, in the language it was spoken. Never translated. */
  text: z.string().trim().min(1).max(LIMITS.textMax),
  owner: speaker,
  due: dueDate,
});

/** The strict shape: what a draft must be to be storable and sendable. */
const schema = z.object({
  /** Connective prose, in the DRAFT language (§4.10). */
  summary: z.string().trim().min(1).max(LIMITS.summaryMax),
  key_points: z.array(keyPoint).max(LIMITS.pointsMax),
  follow_ups: z.array(followUp).max(LIMITS.followUpsMax),
});

/**
 * Coerce a provider's answer into the contract, or return null.
 *
 * Deliberately forgiving in three specific ways, each of which is a real
 * failure mode of a language model rather than a hypothetical:
 *
 *   - it wraps the object in prose or a ```json fence — `extractJson` finds
 *     the first balanced object in the string;
 *   - it emits extra keys, or a `due` of `""`, or a speaker it invented —
 *     unknown keys are dropped, blank dates become null, and a point whose
 *     speaker cannot be read is attributed to the side that said it (the
 *     caller of this function knows which side was which) rather than lost;
 *   - it returns twenty key points — the list is capped, because a draft
 *     nobody finishes reading is a draft nobody sends.
 *
 * It is NOT forgiving about the one thing that must never be invented: an
 * empty result stays empty. Returning null there is what makes the pipeline
 * fall back to the labelled, transcript-only draft instead of posting a
 * confident summary of nothing.
 */
function sanitise(value) {
  const raw = typeof value === "string" ? extractJson(value) : value;
  if (!raw || typeof raw !== "object") return null;

  const summary = String(raw.summary ?? "").trim().slice(0, LIMITS.summaryMax);
  if (!summary) return null;

  const points = asArray(raw.key_points)
    .map((p) => ({
      text: String((p && p.text) || "").trim().slice(0, LIMITS.textMax),
      raised_by: readSpeaker(p && (p.raised_by || p.owner || p.speaker)),
    }))
    .filter((p) => p.text)
    .slice(0, LIMITS.pointsMax);

  const followUps = asArray(raw.follow_ups ?? raw.followUps)
    .map((f) => ({
      text: String((f && f.text) || "").trim().slice(0, LIMITS.textMax),
      owner: readSpeaker(f && (f.owner || f.raised_by || f.speaker)),
      due: readDue(f && (f.due ?? f.due_date)),
    }))
    .filter((f) => f.text)
    .slice(0, LIMITS.followUpsMax);

  // `raised_by`/`owner` default to the CALLER when the model said something we
  // cannot read — the caller is the human in the loop (decision row 3), and a
  // person who is wrong about attribution can see and fix it in the editable
  // draft, where a dropped point is simply gone.
  return {
    summary,
    key_points: points.map((p) => ({ ...p, raised_by: p.raised_by || "caller" })),
    follow_ups: followUps.map((f) => ({ ...f, owner: f.owner || "caller" })),
  };
}

/** The first balanced `{…}` in a string, or null. Tolerates ```json fences. */
function extractJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  // A single object where a list was asked for is a common model shape, and
  // rejecting it would throw away the one point it did produce.
  return v && typeof v === "object" ? [v] : [];
}

/** A speaker the model named, or null when it said something unreadable. */
function readSpeaker(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "caller" || s === "callee" ? s : null;
}

/** An ISO date, a parseable date, or nothing. Anything else is null. */
function readDue(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[1] ? m[1] : null;
}

/** The languages this contract speaks, as a guard rather than a list to copy. */
function isLanguage(value) {
  return LANGUAGES.includes(String(value || "").toLowerCase());
}

module.exports = { schema, sanitise, extractJson, isLanguage, language, LANGUAGES, LIMITS };
