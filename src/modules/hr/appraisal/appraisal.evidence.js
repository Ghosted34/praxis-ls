/**
 * Scoring a KPI from what the system already knows (MOD-13 / 0701) — pure.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `appraisal.actual_value` is typed by a human. Meanwhile the product knows
 * exactly how punctual somebody was (attendance_day, 0697), what rules they
 * breached, how much unexcused absence they took and what training they
 * completed — and an appraisal ignored all of it. So the "objective" half of a
 * performance review was somebody's recollection keyed into a box, three months
 * after the fact, for twelve people at once.
 *
 * ── THE TWO RULES EVERYTHING HERE FOLLOWS ──────────────────────────────────
 *
 *   NO DATA IS NOT A ZERO. A new hire with no reconciled attendance, or a
 *   tenant that has never switched the reconciler on, must come back
 *   `{ rating: null, reason }` — never 0. Zero reads as "failed", and a manager
 *   skimming twenty rows will not stop to ask which kind of zero it is. This is
 *   the single most important property in the file.
 *
 *   THE WORKING IS RETURNED WITH THE ANSWER. Every result carries the counts it
 *   was computed from, because an employee disputing a score is entitled to the
 *   arithmetic, not the verdict.
 */
"use strict";

/** Ratings are on 0–5 unless the target says otherwise. */
const DEFAULT_SCALE = 5;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Fraction (0..1) → a rating on the scale. */
const onScale = (fraction, scale = DEFAULT_SCALE) =>
  round2(Math.max(0, Math.min(1, fraction)) * Number(scale || DEFAULT_SCALE));

/**
 * Punctuality: what share of the days somebody worked did they arrive on time?
 *
 * Measured against days ACTUALLY WORKED, not against the calendar — otherwise
 * approved leave, public holidays and a four-day contract all read as lateness,
 * and the people penalised hardest would be the ones who took the leave they
 * are owed.
 */
function punctuality({ present_days = 0, late_days = 0, scale = DEFAULT_SCALE } = {}) {
  const worked = Number(present_days) || 0;
  if (worked <= 0) {
    return { rating: null, reason: "no_attendance", evidence: { present_days: 0 } };
  }
  const late = Math.min(Number(late_days) || 0, worked);
  const onTime = worked - late;
  return {
    rating: onScale(onTime / worked, scale),
    evidence: { source: "attendance_punctuality", present_days: worked, late_days: late, on_time_days: onTime },
  };
}

/**
 * Absence: unexcused days against days the person was expected.
 *
 * Approved leave is not absence and never appears here — the reconciler
 * distinguishes them (0697), which is the whole reason that table exists.
 */
function absence({ expected_days = 0, absent_days = 0, scale = DEFAULT_SCALE } = {}) {
  const expected = Number(expected_days) || 0;
  if (expected <= 0) {
    return { rating: null, reason: "no_attendance", evidence: { expected_days: 0 } };
  }
  const absent = Math.min(Number(absent_days) || 0, expected);
  return {
    rating: onScale((expected - absent) / expected, scale),
    evidence: { source: "attendance_absence", expected_days: expected, absent_days: absent },
  };
}

/**
 * Conduct: breaches of the house rules over the cycle.
 *
 * A count has no natural denominator, so this is a step-down from full marks
 * rather than a ratio: nobody's conduct is "60% of the available conduct". The
 * tolerance is the number of breaches that costs nothing — one late-running
 * morning in six months is not a disciplinary pattern, and a scale that says
 * otherwise trains managers to ignore it.
 */
function conduct({ breaches = 0, tolerance = 1, scale = DEFAULT_SCALE } = {}) {
  const n = Number(breaches) || 0;
  const free = Number(tolerance) || 0;
  const over = Math.max(0, n - free);
  // Each breach past the tolerance costs a fifth of the scale, floored at zero.
  const rating = round2(Math.max(0, Number(scale) - over * (Number(scale) / 5)));
  return {
    rating,
    evidence: { source: "rule_breaches", breaches: n, tolerance: free, counted: over },
  };
}

/**
 * Training: sessions attended against sessions the person was rostered onto.
 *
 * Rostered, not offered — somebody who was never put on a course has not failed
 * to attend it.
 */
function training({ rostered = 0, attended = 0, scale = DEFAULT_SCALE } = {}) {
  const total = Number(rostered) || 0;
  if (total <= 0) {
    return { rating: null, reason: "not_rostered", evidence: { rostered: 0 } };
  }
  const went = Math.min(Number(attended) || 0, total);
  return {
    rating: onScale(went / total, scale),
    evidence: { source: "training_completion", rostered: total, attended: went },
  };
}

/**
 * KPI attainment — the one source that already existed, moved here so every
 * source returns the same shape and `no target` stops being a silent null.
 */
function attainment({ actual, target, scale = DEFAULT_SCALE } = {}) {
  const a = Number(actual);
  const t = Number(target);
  if (!Number.isFinite(a) || !Number.isFinite(t) || t <= 0) {
    return { rating: null, reason: "no_target", evidence: { actual: Number.isFinite(a) ? a : null, target: Number.isFinite(t) ? t : null } };
  }
  return {
    rating: onScale(a / t, scale),
    evidence: { source: "kpi_attainment", actual: a, target: t, attainment_pct: round2((a / t) * 100) },
  };
}

const SOURCES = {
  attendance_punctuality: punctuality,
  attendance_absence: absence,
  rule_breaches: conduct,
  training_completion: training,
  kpi_attainment: attainment,
};

/**
 * Score one target from the gathered facts.
 *
 * An unknown source is `unknown_source`, not zero — a tenant naming a metric
 * the scorer has not learned yet gets an honest gap on the row rather than an
 * employee marked down for it.
 */
function scoreTarget(target = {}, facts = {}) {
  const source = target.auto_source;
  if (!source) return { rating: null, reason: "manual", evidence: null };
  const fn = SOURCES[source];
  if (!fn) return { rating: null, reason: "unknown_source", evidence: { source } };
  return fn({ ...facts, scale: target.scale_max || DEFAULT_SCALE });
}

/**
 * Roll a cycle's ratings into one figure.
 *
 * Weights are RENORMALISED across the rows that actually have a rating, which
 * is the difference between "we could not measure your training" and "you
 * scored zero on training". Without it, one unscored KPI at 25% weight would
 * quietly cost a quarter of everybody's appraisal.
 */
function overall(rows = []) {
  const scored = rows.filter((r) => r.rating !== null && r.rating !== undefined && Number.isFinite(Number(r.rating)));
  const weight = scored.reduce((n, r) => n + (Number(r.weight) || 0), 0);
  if (!scored.length) return { score: null, scored: 0, of: rows.length, weight_used: 0 };
  // No weights anywhere (a tenant that never set them) → a plain mean, which is
  // what a reader assumes an unweighted list means.
  if (weight <= 0) {
    return {
      score: round2(scored.reduce((n, r) => n + Number(r.rating), 0) / scored.length),
      scored: scored.length,
      of: rows.length,
      weight_used: 0,
    };
  }
  const sum = scored.reduce((n, r) => n + Number(r.rating) * (Number(r.weight) || 0), 0);
  return { score: round2(sum / weight), scored: scored.length, of: rows.length, weight_used: round2(weight) };
}

/**
 * The band a score falls in.
 *
 * Words rather than a number on the review, because "3.7" invites an argument
 * about the third decimal place and "Meets expectations" invites one about the
 * work. Thresholds are on the 0–5 scale.
 */
const BANDS = [
  { at: 4.5, band: "Outstanding" },
  { at: 3.5, band: "Exceeds expectations" },
  { at: 2.5, band: "Meets expectations" },
  { at: 1.5, band: "Below expectations" },
  { at: 0, band: "Unsatisfactory" },
];

function bandFor(score, scale = DEFAULT_SCALE) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
  // Normalised so a tenant scoring out of 10 gets the same words.
  const onFive = (Number(score) / (Number(scale) || DEFAULT_SCALE)) * DEFAULT_SCALE;
  return (BANDS.find((b) => onFive >= b.at) || BANDS[BANDS.length - 1]).band;
}

/**
 * Do this employee's weights add up?
 *
 * Returned rather than enforced at write time: an HR manager building a set of
 * targets is legitimately unbalanced half way through, and refusing the fourth
 * KPI because the first three do not yet total 100 makes the screen unusable.
 * The cycle's own transition to SCORING is where it is insisted on.
 */
function weightCheck(targets = []) {
  const total = round2(targets.reduce((n, t) => n + (Number(t.weight) || 0), 0));
  return { total, target: 100, balanced: total === 100 };
}

module.exports = {
  DEFAULT_SCALE,
  BANDS,
  punctuality,
  absence,
  conduct,
  training,
  attainment,
  scoreTarget,
  overall,
  bandFor,
  weightCheck,
  SOURCES: Object.keys(SOURCES),
};
