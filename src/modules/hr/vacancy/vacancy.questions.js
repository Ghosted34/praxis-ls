/**
 * Interview questions, generated once per vacancy and then edited by hand.
 *
 * ── WHY THEY ARE STORED AND NOT GENERATED PER INTERVIEW ────────────────────
 *
 * The obvious design is to generate questions when an interview starts, tailored
 * to that candidate's CV. It is also the wrong one, and not for a technical
 * reason: two candidates asked different questions cannot be compared, so the
 * scorecard that hangs off them becomes a collection of unrelated opinions
 * rather than evidence. A structured interview — same questions, same order,
 * rated independently — is both the fairer process and the one that survives
 * being challenged. Storing the set on the VACANCY is what enforces it.
 *
 * The model drafts; a person edits. `ai_generated` records which is which, so a
 * question somebody wrote themselves is never quietly replaced by a regenerate.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

/** Enough to structure an hour; more than this and interviewers skip, which
 *  reintroduces the inconsistency the stored set exists to remove. */
const MAX_QUESTIONS = 8;

function buildPrompt(vacancy, criteria) {
  const role = [
    `Title: ${vacancy.title}`,
    vacancy.department ? `Department: ${vacancy.department}` : null,
    vacancy.employment_type ? `Employment type: ${vacancy.employment_type}` : null,
    vacancy.experience_years_min ? `Minimum experience: ${vacancy.experience_years_min} years` : null,
    (vacancy.skills_required || []).length ? `Required skills: ${vacancy.skills_required.join(", ")}` : null,
    vacancy.description ? `Description:\n${vacancy.description}` : null,
  ].filter(Boolean).join("\n");

  const extra = criteria.length
    ? `\n\nThe recruiter especially wants to probe:\n${criteria.map((c) => `- ${c.label}${c.guidance ? ` — ${c.guidance}` : ""}`).join("\n")}`
    : "";

  return [
    {
      role: "system",
      content:
        `You write interview questions. Produce at most ${MAX_QUESTIONS}, ordered so the ` +
        "conversation opens broad and narrows. Every question must ask for a SPECIFIC PAST " +
        "INSTANCE with a result the candidate can name — behavioural, not hypothetical, and " +
        "never answerable with a yes or a definition. " +
        "Ask nothing about age, sex, marital or family status, pregnancy, nationality, " +
        "ethnicity, religion, disability, health or politics; those are unlawful to ask in " +
        "most jurisdictions and irrelevant in all of them. " +
        "`rationale` is for the interviewer's eyes only: say what a strong answer contains " +
        "and what a weak one sounds like. " +
        'Reply with ONLY a JSON array: [{"question": string, "rationale": string}]',
    },
    { role: "user", content: `ROLE\n${role}${extra}` },
  ];
}

/** Pull the array out of a reply that may be fenced or wrapped in prose. */
function parseQuestions(text) {
  const raw = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((q) => ({
      // Tolerates a model that returned bare strings instead of objects, which
      // is the single most common deviation from the contract and not worth
      // discarding a whole usable set over.
      question: String((q && q.question) || (typeof q === "string" ? q : "")).trim().slice(0, 1000),
      rationale: q && q.rationale ? String(q.rationale).trim().slice(0, 1000) : null,
    }))
    .filter((q) => q.question.length > 8)
    .slice(0, MAX_QUESTIONS);
}

/**
 * Draft a question set for a vacancy. Returns [] when the model is unconfigured
 * or answered unusably — the caller keeps whatever is already there rather than
 * wiping a hand-written set because a provider had a bad minute.
 *
 * Call OUTSIDE a transaction: this is a network wait.
 */
async function generate(client, { vacancy, criteria = [] }) {
  try {
    const { text } = await llm.chat({ client, messages: buildPrompt(vacancy, criteria), temperature: 0.4 });
    return parseQuestions(text);
  } catch (err) {
    logger.warn({ err, vacancyId: vacancy.vacancy_id }, "[recruitment] interview question generation failed");
    return [];
  }
}

module.exports = { generate, parseQuestions, MAX_QUESTIONS };
