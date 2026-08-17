/**
 * Session minutes, drafted (MOD-18 / 0702).
 *
 * ── WHAT THIS SUMMARISES, AND WHAT IT MUST NOT INVENT ──────────────────────
 *
 * The input is what was actually captured: the notes somebody typed during the
 * session, the transcript if one was dictated, and the roster. The output is a
 * tidy-up of those — headings, an ordered list of what was covered, and the
 * actions people committed to.
 *
 * The failure to design against is a model asked to "write the minutes of a
 * forklift safety course" producing an excellent, entirely fictional account of
 * a course it knows nothing about. Minutes are a record; a plausible record of
 * something that did not happen is worse than no record, because it is filed,
 * signed off, and later relied on. So:
 *
 *   - It is given the captured material and told, explicitly, that it is the
 *     only source. Nothing outside it may appear.
 *   - It is told to write "not recorded" where a section has nothing behind it
 *     rather than filling the gap — an empty Actions heading is information.
 *   - It never states who attended. The roster is data the system holds
 *     exactly; asking a model to restate it can only introduce error.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * Same call as 0700's contract drafter, for the same reason. A tenant with no
 * AI vendor configured still ran the session, and the notes are still worth
 * filing. `summarise` returns null on any failure and the caller files the raw
 * notes instead — a session's record must never depend on a model answering.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

/** Enough captured material to be worth summarising. Below this the notes ARE
 *  the minutes, and running them through a model can only pad them. */
const MIN_SOURCE_CHARS = 200;

/** Strip the wrapper a model puts around markdown when asked for a document,
 *  and normalise the runs of blank lines that come with it. */
function tidy(text) {
  let s = String(text || "").trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/;
  const m = fence.exec(s);
  if (m) s = m[1].trim();
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Everything captured about a session, as one block of text for the prompt.
 * Minutes are listed before loose notes because they are the agreed record and
 * a summary should lead with them.
 */
function sourceText({ notes = [], transcript = null } = {}) {
  const parts = [];
  const minutes = notes.filter((n) => n.is_minutes);
  const loose = notes.filter((n) => !n.is_minutes);
  if (minutes.length) parts.push("## Minutes taken during the session\n" + minutes.map((n) => "- " + String(n.body || "").trim()).join("\n"));
  if (loose.length) parts.push("## Notes\n" + loose.map((n) => "- " + String(n.body || "").trim()).join("\n"));
  const t = String(transcript || "").trim();
  if (t) parts.push("## Transcript\n" + t);
  return parts.join("\n\n").trim();
}

function promptMessages(session = {}, source = "") {
  const facts = [
    session.title ? `Title: ${session.title}` : null,
    session.facilitator ? `Facilitator: ${session.facilitator}` : null,
    session.starts_at ? `Scheduled: ${session.starts_at}` : null,
    session.mode ? `Mode: ${String(session.mode).toLowerCase().replace("_", "-")}` : null,
    session.location ? `Location: ${session.location}` : null,
  ].filter(Boolean).join("\n");

  return [
    {
      role: "system",
      content: [
        "You write the minutes of a staff training session for an HR record.",
        "",
        "THE CAPTURED MATERIAL BELOW IS YOUR ONLY SOURCE. Do not add anything that is not in it — no topics you would expect a course of this title to cover, no conclusions, no recommendations of your own. A plausible account of a session that did not happen is worse than a short one that did.",
        "",
        "Where a section has nothing behind it, write 'Not recorded.' under the heading. An empty section is information: it tells the reader nobody captured it.",
        "",
        "Do NOT list or count attendees. The attendance roster is held separately and exactly.",
        "",
        "Structure, using markdown '##' headings, in this order:",
        "## Summary — two or three sentences on what the session covered.",
        "## Topics covered — a bulleted list, in the order they appear in the source.",
        "## Decisions and actions — who committed to what, only where the source says so.",
        "## Follow-up — anything the source flags as outstanding.",
        "",
        "Write in plain British English, past tense, third person. No preamble, no closing remarks, no note about being an AI. Return markdown only.",
      ].join("\n"),
    },
    { role: "user", content: `Session details:\n${facts || "(none recorded)"}\n\nCaptured material:\n\n${source}` },
  ];
}

/**
 * Draft the minutes. Returns `{ body_md, ai_model }`, or null when there was
 * too little to summarise or the model could not be reached — the caller files
 * the raw notes in that case rather than nothing.
 */
async function summarise(client, { session = {}, notes = [], transcript = null } = {}) {
  const source = sourceText({ notes, transcript });
  if (source.length < MIN_SOURCE_CHARS) return null;
  try {
    const { text, provider } = await llm.chat({
      client,
      messages: promptMessages(session, source),
      temperature: 0.2, // A record, not a piece of writing.
    });
    const body = tidy(text);
    // Shorter than the material it was given is a model that failed to engage
    // with it, not a concise summary.
    if (body && body.length > 120) return { body_md: body, ai_model: provider || "ai" };
    logger.warn({ provider, length: body ? body.length : 0 }, "[training] minutes draft too short — filing the raw notes");
  } catch (err) {
    logger.warn({ err }, "[training] minutes drafting failed — filing the raw notes");
  }
  return null;
}

module.exports = { summarise, sourceText, promptMessages, tidy, MIN_SOURCE_CHARS };
