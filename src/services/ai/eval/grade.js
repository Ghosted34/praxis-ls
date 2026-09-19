/**
 * The grader — what makes an assistant answer pass or fail (audit H1).
 *
 * ── WHY A PURE FUNCTION, SEPARATE FROM THE RUNNER ───────────────────────────
 *
 * H1 asks for "a repeatable eval ... run it in CI as a gate", and the obvious
 * shape — ask a live model a seeded question in CI and assert on the reply —
 * cannot BE a gate. It needs a tenant database, a funded vendor credential and
 * a model whose output is different every run. A build that fails because a
 * model phrased something differently today teaches one lesson, which is to
 * stop reading the build.
 *
 * So the eval splits along the line `scripts/ci-local.js` already draws:
 *
 *   THIS FILE is pure. Answer text in, verdict out, no clock, no network, no
 *   database. It is the part that encodes what "correct" means, and it runs in
 *   CI against recorded answers — so the RULES are regression-tested even
 *   though the model is not.
 *
 *   `scripts/ai/eval.js` is the live pass. It needs the infrastructure, runs
 *   the golden set against a seeded tenant, and grades every answer through
 *   this exact function. It reports; it does not gate.
 *
 * The value is in that split. A grader nobody can run without a database is a
 * grader that rots; a gate that depends on a language model is a gate that gets
 * disabled. This way the definition of a correct answer is under test on every
 * push, and the expensive pass reuses it verbatim rather than re-implementing
 * it slightly differently.
 *
 * ── THE CHECK THAT THIS EXISTS FOR ──────────────────────────────────────────
 *
 * A1 (PR 1) was the audit's sharpest finding: a blanket `\d{9,}` blackout meant
 * the model was handed `[NUM]` instead of the figures it was being asked about,
 * so "what is our largest receivable" could not be answered correctly even in
 * principle. The audit names the regression test by hand: "a seeded figure
 * ≥ 100,000,000 XAF reported exactly, and a `[NUM]` in an answer treated as a
 * failure." `noRedactionMarkers` is that sentence as code, and it is a failure
 * on ANY marker rather than just `[NUM]` — the same split that let `[NUM]`
 * through the reasoning path can let `[EMAIL]` or `[PASSPORT]` through, and a
 * scrubbed placeholder in a tenant-facing answer is always a defect.
 */
"use strict";

/**
 * Every placeholder `redact.js` can emit. A tenant-facing ANSWER must contain
 * none of them: the reasoning path sees the caller's own authorised data, so a
 * marker in the reply means the egress split has regressed (audit A1/F3).
 */
const REDACTION_MARKERS = [
  "[NUM]", "[EMAIL]", "[PHONE]", "[IBAN]", "[RIB]",
  "[CARD]", "[NIU]", "[PASSPORT]", "[SSN]",
];

/** Digits only, so "102,500,000" / "102 500 000" / "102500000" compare equal. */
const digitsOf = (s) => String(s === null || s === undefined ? "" : s).replace(/[^\d]/g, "");

/**
 * Does the answer state this figure?
 *
 * Compared on DIGITS, because how a number is punctuated is a formatting
 * question and this check is an accuracy one — the audit's requirement is that
 * the figure is "reported exactly", not that it is grouped a particular way.
 * The search is over the answer's own digit runs rather than the whole string
 * with separators stripped, so 102,500,000 is not satisfied by an answer that
 * happens to contain 1025 next to 00000 in unrelated places.
 */
function statesFigure(answer, figure) {
  const want = digitsOf(figure);
  if (!want) return false;
  return (String(answer).match(/[\d][\d\s,.\u202f\u00a0]*/g) || []).some(
    (run) => digitsOf(run) === want,
  );
}

/** A day-first date, or a month written as a word — both unambiguous here. */
const MONTH_WORD = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

/**
 * Numeric dates the reader would resolve differently than the writer meant.
 *
 * ONLY dd/mm where the first part is ≤ 12, because that is the ambiguous set —
 * 25/07 can only be day-first, and there is nothing to warn about. This flags
 * a date that is AMBIGUOUS, not one that is wrong, which is the honest thing a
 * static check can say about prose. The product is day-first everywhere else
 * (`check-date-format.js`), and that gate cannot reach a sentence a model
 * composed — which is exactly why the style contract (B6) states the rule and
 * this measures whether it held.
 */
function ambiguousDates(answer) {
  const out = [];
  for (const m of String(answer).matchAll(/\b(\d{1,2})[/](\d{1,2})[/](\d{2,4})\b/g)) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    if (first <= 12 && second <= 12 && first !== second) out.push(m[0]);
  }
  return out;
}

/** Something that reads like a database identifier leaking into prose. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/**
 * snake_case that is a FIELD NAME rather than an action key.
 *
 * `create_purchase_order` is a tool the assistant may legitimately name when
 * explaining what it is about to do; `payment_terms_days` is the thing the
 * LANGUAGE RULES forbid. The difference is the leading verb, so action-shaped
 * tokens are excluded rather than the check being dropped.
 */
const ACTION_PREFIX = /^(list|get|create|update|record|draft|post|send|sign|delete|cancel|submit|approve|confirm|search|find)_/;
function leakedFieldNames(answer) {
  const tokens = String(answer).match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) || [];
  return [...new Set(tokens.filter((t) => !ACTION_PREFIX.test(t)))];
}

/** Openers the style contract bans (audit B6). */
const FILLER = /^\s*(certainly|sure|of course|great question|absolutely|happy to help|i'd be happy)/i;

/**
 * An answer cut off mid-thought.
 *
 * `finishReason === "length"` is the authoritative signal and is preferred when
 * the runner captured one. The text heuristic is the fallback for a recorded
 * answer that carries no vendor metadata: it is deliberately conservative —
 * only an answer with no terminal punctuation at all — because a false
 * truncation failure on a legitimately terse reply would make the whole eval
 * untrustworthy.
 */
function looksTruncated(answer, finishReason) {
  if (finishReason === "length") return true;
  const t = String(answer).trim();
  if (!t) return false;
  return !/[.!?:)\]"'`»]|\|$/.test(t.slice(-1)) && !t.endsWith("```");
}

/**
 * Grade one answer against one case's expectations.
 *
 * Returns every failure rather than the first: a run that reports "truncated"
 * and stops, when the answer was also missing its figure and named a UUID, has
 * cost the reader two more runs to find that out. Same reasoning as
 * `ci-local.js` reporting all gates.
 *
 * @param {object} result   what the assistant produced: { answer, toolsUsed,
 *                          writes, finishReason }
 * @param {object} expect_  the case's expectations (see golden-set.js)
 */
function gradeAnswer(result = {}, expect_ = {}) {
  const answer = String(result.answer || "");
  const toolsUsed = result.toolsUsed || [];
  const writes = result.writes || [];
  const failures = [];
  const fail = (check, detail) => failures.push({ check, detail });

  // ── A1: grounding accuracy ───────────────────────────────────────────────
  for (const figure of expect_.reportsExactly || []) {
    if (!statesFigure(answer, figure)) {
      fail("reportsExactly", `the answer does not state ${figure}`);
    }
  }
  // The audit's named regression: a placeholder in a tenant-facing answer.
  const markers = REDACTION_MARKERS.filter((m) => answer.includes(m));
  if (markers.length) {
    fail("noRedactionMarkers", `answer contains ${markers.join(", ")} — the caller's own data was scrubbed from their own answer (A1)`);
  }
  for (const text of expect_.mentions || []) {
    if (!answer.toLowerCase().includes(String(text).toLowerCase())) {
      fail("mentions", `the answer does not mention ${text}`);
    }
  }
  for (const text of expect_.forbids || []) {
    if (answer.toLowerCase().includes(String(text).toLowerCase())) {
      fail("forbids", `the answer mentions ${text}, which this case forbids`);
    }
  }

  // ── B1: no truncation ────────────────────────────────────────────────────
  if (expect_.notTruncated !== false && looksTruncated(answer, result.finishReason)) {
    fail("notTruncated", "the answer stops mid-thought");
  }

  // ── D4/G1: tool selection ────────────────────────────────────────────────
  for (const key of expect_.usesTools || []) {
    if (!toolsUsed.includes(key)) fail("usesTools", `${key} was not called (called: ${toolsUsed.join(", ") || "nothing"})`);
  }
  for (const key of expect_.neverTools || []) {
    if (toolsUsed.includes(key)) fail("neverTools", `${key} was called and must not be`);
  }

  // ── C1-C4: the write actually ran, as the caller ─────────────────────────
  for (const key of expect_.proposesWrite || []) {
    const run = writes.find((w) => w.actionKey === key);
    if (!run) {
      fail("proposesWrite", `${key} was not proposed`);
      continue;
    }
    // The audit's C2: a write that runs with the actor dropped attributes the
    // change to nobody, and the failure is invisible in the answer text.
    if (run.actorUserId === null || run.actorUserId === undefined) fail("proposesWrite", `${key} ran with no actor`);
  }

  // ── B6: the style contract ───────────────────────────────────────────────
  if (expect_.style !== false) {
    if (FILLER.test(answer)) fail("style", "the answer opens with filler");
    if (UUID_RE.test(answer)) fail("style", "the answer shows a raw identifier");
    const leaked = leakedFieldNames(answer);
    if (leaked.length) fail("style", `the answer shows raw field names: ${leaked.join(", ")}`);
    const ambiguous = ambiguousDates(answer);
    if (ambiguous.length) {
      fail("style", `ambiguous numeric date(s) ${ambiguous.join(", ")} — write the month as a word (this corridor reads day-first)`);
    }
    if (expect_.expectsTable && !/\n\s*\|.*\|/.test(answer)) {
      fail("style", "tabular data was not put in a table");
    }
  }

  return { id: expect_.id || null, passed: failures.length === 0, failures };
}

/** Grade a whole run. `results` is keyed by case id. */
function gradeRun(cases, results) {
  const graded = cases.map((c) => gradeAnswer(results[c.id] || {}, c));
  const passed = graded.filter((g) => g.passed).length;
  return {
    total: graded.length,
    passed,
    failed: graded.length - passed,
    cases: graded,
  };
}

module.exports = {
  gradeAnswer,
  gradeRun,
  REDACTION_MARKERS,
  // Exported for the grader's own tests — each is a rule worth pinning alone.
  statesFigure,
  ambiguousDates,
  leakedFieldNames,
  looksTruncated,
  MONTH_WORD,
};
