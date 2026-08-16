/**
 * Appraisal cycles and reviews (MOD-13 / 0701).
 *
 * ── THE THREE THINGS THIS ADDS, AND WHY EACH ONE MATTERS ───────────────────
 *
 *   A CYCLE, so "who has not been appraised for H1?" is answerable. It was not:
 *   `period_code` was a string on each KPI row, and nothing knew a round was
 *   open, scoring, or done.
 *
 *   EVIDENCE, so the objective half of a review is not somebody's recollection.
 *   The product already knew how punctual each person was, what rules they
 *   breached, what leave they took and what training they completed — and the
 *   appraisal ignored all of it.
 *
 *   THE EMPLOYEE, so a performance record that may later justify a dismissal
 *   has been seen by the person it is about. There was `rated_by` and nothing
 *   else.
 *
 * ── WHAT THE SCORER WILL NOT DO ────────────────────────────────────────────
 *
 * It never touches a CALIBRATED row. A manager's judgement has to survive
 * somebody pressing "re-score" a fortnight later — otherwise the button is a
 * way to quietly erase a decision, and nobody would dare press it.
 *
 * It writes `ai_rating`, never `rating`. The two sit side by side permanently:
 * the entire value of showing a manager an evidence-derived number is that they
 * can disagree with it, and a column that silently becomes one or the other
 * destroys exactly that.
 */
"use strict";
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const events = require("./appraisal.events");
const ev = require("./appraisal.evidence");
const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");

const cycleRef = (id) => `appraisal_cycle:${id}`;
const reviewRef = (id) => `appraisal_review:${id}`;

/* ── Cycles ──────────────────────────────────────────────────────────────── */

async function listCycles(client) {
  const { rows } = await client.query(
    `SELECT c.*,
            (SELECT count(*) FROM appraisal_review r WHERE r.appraisal_cycle_id = c.appraisal_cycle_id)::int AS review_count,
            (SELECT count(*) FROM appraisal_review r
              WHERE r.appraisal_cycle_id = c.appraisal_cycle_id
                AND r.status IN ('ACKNOWLEDGED','FINALISED'))::int AS settled_count
       FROM appraisal_cycle c
      ORDER BY c.starts_on DESC`,
  );
  return rows;
}

const getCycle = async (client, id) => {
  const { rows } = await client.query("SELECT * FROM appraisal_cycle WHERE appraisal_cycle_id = $1", [id]);
  return rows[0] || null;
};

async function createCycle(client, { data, actor = {} }) {
  const { rows: clash } = await client.query("SELECT 1 FROM appraisal_cycle WHERE code = $1", [data.code]);
  if (clash[0]) throw new AppError("DUPLICATE", `A cycle with code ${data.code} already exists`, 409);
  const { rows } = await client.query(
    `INSERT INTO appraisal_cycle (code, name, starts_on, ends_on, status)
     VALUES ($1,$2,$3,$4,coalesce($5,'DRAFT')) RETURNING *`,
    [data.code, data.name, data.starts_on, data.ends_on, data.status],
  );
  await audit(client, { actorUserId: actor.user_id || null, action: "appraisal_cycle.created", moduleKey: events.MODULE, entityRef: cycleRef(rows[0].appraisal_cycle_id), after: rows[0] });
  return rows[0];
}

/** Forward only, with one loop back from CALIBRATION — moderation genuinely
 *  sends scores back for re-scoring, and everything else is a decision. */
const CYCLE_TRANSITIONS = {
  DRAFT: ["OPEN"],
  OPEN: ["SCORING"],
  SCORING: ["CALIBRATION", "RELEASED"],
  CALIBRATION: ["SCORING", "RELEASED"],
  RELEASED: ["CLOSED"],
  CLOSED: [],
};

async function setCycleStatus(client, { id, status, actor = {} }) {
  const before = await getCycle(client, id);
  if (!before) return null;
  const allowed = CYCLE_TRANSITIONS[before.status] || [];
  if (!allowed.includes(status)) {
    throw new AppError("INVALID_TRANSITION", `Cannot move cycle ${before.status} → ${status}`, 422);
  }
  // Releasing is the moment employees can read their reviews. A review still in
  // DRAFT at that point would be shown half-written, which is worse than being
  // late — so the cycle refuses to release until every review has been
  // submitted.
  if (status === "RELEASED") {
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM appraisal_review WHERE appraisal_cycle_id = $1 AND status = 'DRAFT'",
      [id],
    );
    if (rows[0].n > 0) {
      throw new AppError("REVIEWS_INCOMPLETE", `${rows[0].n} review(s) are still in draft`, 422, {
        status: ["Submit every review before releasing the cycle."],
      });
    }
  }
  const { rows } = await client.query(
    "UPDATE appraisal_cycle SET status = $2, updated_at = now() WHERE appraisal_cycle_id = $1 RETURNING *",
    [id, status],
  );
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: cycleRef(id), actorUserId: actor.user_id || null, payload: { from: before.status, to: status } });
  await audit(client, { actorUserId: actor.user_id || null, action: "appraisal_cycle.status_changed", moduleKey: events.MODULE, entityRef: cycleRef(id), before, after: rows[0] });
  return rows[0];
}

/* ── Evidence ────────────────────────────────────────────────────────────── */

/**
 * Everything the system already knows about one employee over a window.
 *
 * One query per source rather than one giant join: the sources are independent,
 * a tenant may have none of them (the reconciler unrun, no training rostered),
 * and a join would turn "no attendance" into "no row" for training as well.
 */
async function gather(client, { employeeId, from, to }) {
  const facts = {};

  const { rows: att } = await client.query(
    `SELECT count(*) FILTER (WHERE status IN ('PRESENT','LATE'))::int AS present_days,
            count(*) FILTER (WHERE status = 'LATE' AND NOT justified)::int AS late_days,
            count(*) FILTER (WHERE status = 'ABSENT' AND NOT justified)::int AS absent_days,
            count(*) FILTER (WHERE status IN ('PRESENT','LATE','ABSENT'))::int AS expected_days,
            count(*) FILTER (WHERE hr_rule_id IS NOT NULL AND NOT justified)::int AS breaches
       FROM attendance_day
      WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3`,
    [employeeId, from, to],
  );
  Object.assign(facts, att[0] || {});

  const { rows: tr } = await client.query(
    `SELECT count(*)::int AS rostered, count(*) FILTER (WHERE ta.attended)::int AS attended
       FROM training_attendance ta
       JOIN training t ON t.training_id = ta.training_id
      WHERE ta.employee_id = $1
        AND t.scheduled_on BETWEEN $2 AND $3`,
    [employeeId, from, to],
  );
  Object.assign(facts, tr[0] || {});

  return facts;
}

/**
 * Score every auto-sourced target for one employee in a cycle.
 *
 * Writes `ai_rating` and the working onto the appraisal row, creating the row
 * if the target has none yet — a KPI nobody has scored by hand still deserves
 * its evidence gathered, and that is most of them at the start of a round.
 */
async function scoreEmployee(client, { cycleId, employeeId, actor = {} }) {
  const cycle = await getCycle(client, cycleId);
  if (!cycle) throw new AppError("NOT_FOUND", "Cycle not found", 404);

  const { rows: targets } = await client.query(
    `SELECT * FROM kpi_target
      WHERE employee_id = $1 AND (appraisal_cycle_id = $2 OR appraisal_cycle_id IS NULL)
      ORDER BY metric`,
    [employeeId, cycleId],
  );
  if (!targets.length) return { scored: 0, skipped: 0, targets: 0 };

  const facts = await gather(client, { employeeId, from: cycle.starts_on, to: cycle.ends_on });
  const actorId = await resolveActorId(client, actor.user_id);
  let scored = 0;
  let skipped = 0;

  for (const t of targets) {
    const { rows: existing } = await client.query(
      "SELECT * FROM appraisal WHERE kpi_target_id = $1 AND employee_id = $2 ORDER BY created_at LIMIT 1",
      [t.kpi_target_id, employeeId],
    );
    const row = existing[0] || null;
    // A judgement a human has made is never overwritten. The button must be
    // safe to press, or nobody will press it.
    if (row && row.is_calibrated) {
      skipped += 1;
      continue;
    }

    const out = ev.scoreTarget(t, {
      ...facts,
      actual: row ? row.actual_value : null,
      target: t.target_value,
    });

    if (row) {
      await client.query(
        `UPDATE appraisal SET ai_rating = $2, ai_evidence = $3, ai_scored_at = now(), appraisal_cycle_id = $4
          WHERE appraisal_id = $1`,
        [row.appraisal_id, out.rating, JSON.stringify(out.evidence || { reason: out.reason }), cycleId],
      );
    } else {
      await client.query(
        `INSERT INTO appraisal (kpi_target_id, employee_id, period_code, appraisal_cycle_id,
                                ai_rating, ai_evidence, ai_scored_at, rated_by)
         VALUES ($1,$2,$3,$4,$5,$6, now(), $7)`,
        [t.kpi_target_id, employeeId, cycle.code, cycleId, out.rating,
          JSON.stringify(out.evidence || { reason: out.reason }), actorId],
      );
    }
    if (out.rating !== null) scored += 1;
  }

  return { scored, skipped, targets: targets.length, facts };
}

/* ── Reviews ─────────────────────────────────────────────────────────────── */

const REVIEW_SELECT = `
  SELECT r.*, e.full_name AS employee_name, c.code AS cycle_code, c.name AS cycle_name,
         c.status AS cycle_status, c.starts_on, c.ends_on
    FROM appraisal_review r
    LEFT JOIN employee e ON e.employee_id = r.employee_id
    LEFT JOIN appraisal_cycle c ON c.appraisal_cycle_id = r.appraisal_cycle_id`;

async function listReviews(client, q = {}) {
  const params = [];
  const wh = [];
  if (q.cycle_id) { params.push(q.cycle_id); wh.push(`r.appraisal_cycle_id = $${params.length}`); }
  if (q.employee_id) { params.push(q.employee_id); wh.push(`r.employee_id = $${params.length}`); }
  if (q.status) { params.push(q.status); wh.push(`r.status = $${params.length}`); }
  const { rows } = await client.query(
    `${REVIEW_SELECT} ${wh.length ? "WHERE " + wh.join(" AND ") : ""} ORDER BY e.full_name`,
    params,
  );
  return rows;
}

/**
 * One review, with the rows behind its number.
 *
 * The KPI lines always travel with it: a score without its working is exactly
 * what an employee cannot argue with, and being unable to argue with it is what
 * makes an appraisal process feel arbitrary.
 */
async function getReview(client, id) {
  const { rows } = await client.query(`${REVIEW_SELECT} WHERE r.appraisal_review_id = $1`, [id]);
  const review = rows[0];
  if (!review) return null;
  const { rows: lines } = await client.query(
    `SELECT a.appraisal_id, a.rating, a.ai_rating, a.ai_evidence, a.is_calibrated, a.comments,
            a.actual_value, kt.metric, kt.target_value, kt.weight, kt.auto_source, kt.scale_max
       FROM appraisal a
       LEFT JOIN kpi_target kt ON kt.kpi_target_id = a.kpi_target_id
      WHERE a.employee_id = $1 AND a.appraisal_cycle_id = $2
      ORDER BY kt.metric`,
    [review.employee_id, review.appraisal_cycle_id],
  );
  return { ...review, lines, weights: ev.weightCheck(lines) };
}

/** The caller's own review — only once the cycle has RELEASED. */
async function mine(client, employeeId) {
  if (!employeeId) return [];
  const { rows } = await client.query(
    `${REVIEW_SELECT}
      WHERE r.employee_id = $1
        AND c.status IN ('RELEASED','CLOSED')
        AND r.status <> 'DRAFT'
      ORDER BY c.starts_on DESC`,
    [employeeId],
  );
  return rows;
}

/** Open (or refresh) the review for one employee in a cycle. */
async function upsertReview(client, { cycleId, employeeId, actor = {} }) {
  const { rows } = await client.query(
    `INSERT INTO appraisal_review (appraisal_cycle_id, employee_id)
     VALUES ($1,$2)
     ON CONFLICT (appraisal_cycle_id, employee_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [cycleId, employeeId],
  );
  await audit(client, { actorUserId: actor.user_id || null, action: "appraisal_review.opened", moduleKey: events.MODULE, entityRef: reviewRef(rows[0].appraisal_review_id), after: rows[0] });
  return getReview(client, rows[0].appraisal_review_id);
}

/**
 * Freeze the figures and send the review up.
 *
 * The roll-up is computed HERE and stored, not derived on read: a score an
 * employee has acknowledged must not change afterwards because somebody edited
 * a KPI weight in the next cycle.
 */
async function submitReview(client, { id, managerComment = null, actor = {} }) {
  const review = await getReview(client, id);
  if (!review) return null;
  if (review.status !== "DRAFT") {
    throw new AppError("INVALID_TRANSITION", `This review is already ${review.status.toLowerCase()}`, 422);
  }
  // The human rating decides; the machine's suggestion is only used where no
  // human has given one, and never over a calibrated row.
  const rated = review.lines.map((l) => ({
    rating: l.rating === null || l.rating === undefined ? l.ai_rating : l.rating,
    weight: l.weight,
  }));
  const roll = ev.overall(rated);
  const scale = review.lines.reduce((m, l) => Math.max(m, Number(l.scale_max) || ev.DEFAULT_SCALE), ev.DEFAULT_SCALE);

  const { rows } = await client.query(
    `UPDATE appraisal_review
        SET status = 'SUBMITTED', overall_score = $2, band = $3,
            manager_comment = coalesce($4, manager_comment),
            submitted_by = $5, submitted_at = now(), updated_at = now()
      WHERE appraisal_review_id = $1 RETURNING *`,
    [id, roll.score, ev.bandFor(roll.score, scale), managerComment, await resolveActorId(client, actor.user_id)],
  );
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: reviewRef(id), actorUserId: actor.user_id || null, payload: { status: "SUBMITTED", score: roll.score } });
  await audit(client, { actorUserId: actor.user_id || null, action: "appraisal_review.submitted", moduleKey: events.MODULE, entityRef: reviewRef(id), before: review, after: rows[0] });
  return getReview(client, id);
}

/**
 * The employee's answer — the half that did not exist.
 *
 * A DISPUTE requires words. "I disagree" with no reason is not a record
 * anybody can act on, and the whole point of storing the employee's side is
 * that it can be read later by somebody who was not in the room.
 */
async function respond(client, { id, agree, comment = null, employeeId, actor = {} }) {
  const review = await getReview(client, id);
  if (!review) return null;
  if (review.employee_id !== employeeId) {
    // Not 403: telling a caller that somebody else's review exists is itself a
    // disclosure. They simply do not have one with this id.
    throw new AppError("NOT_FOUND", "Review not found", 404);
  }
  if (!["RELEASED", "CLOSED"].includes(review.cycle_status) || review.status === "DRAFT") {
    throw new AppError("NOT_RELEASED", "This review has not been released yet", 422);
  }
  if (!["SUBMITTED"].includes(review.status)) {
    throw new AppError("INVALID_TRANSITION", `You have already ${review.status.toLowerCase()} this review`, 422);
  }
  if (!agree && !String(comment || "").trim()) {
    throw new AppError("VALIDATION_ERROR", "Say why you disagree", 422, {
      comment: ["A dispute needs a reason — it is the part that gets read later."],
    });
  }
  const { rows } = await client.query(
    `UPDATE appraisal_review
        SET status = $2, employee_comment = $3, responded_at = now(), updated_at = now()
      WHERE appraisal_review_id = $1 RETURNING *`,
    [id, agree ? "ACKNOWLEDGED" : "DISPUTED", comment],
  );
  await emitEvent(client, {
    eventTypeKey: events.UPDATED,
    moduleKey: events.MODULE,
    entityRef: reviewRef(id),
    actorUserId: actor.user_id || null,
    // A dispute is something a manager must see today, not in a digest.
    priority: agree ? "NORMAL" : "HIGH",
    payload: { status: rows[0].status },
  });
  await audit(client, { actorUserId: actor.user_id || null, action: `appraisal_review.${agree ? "acknowledged" : "disputed"}`, moduleKey: events.MODULE, entityRef: reviewRef(id), before: review, after: rows[0] });
  return rows[0];
}

/* ── The narrative ───────────────────────────────────────────────────────── */

/**
 * Write a review narrative from the evidence, grounded in the tenant's SOPs.
 *
 * The model writes PROSE about numbers it is given. It is told the score and
 * the counts and asked to explain them; it is not asked what the score should
 * be. `ai_summary` is a suggestion the manager edits into `manager_comment` —
 * it is never shown to the employee as it stands, which is why the two are
 * different columns.
 *
 * Never throws: an HR manager with no AI vendor writes their own narrative, as
 * they always have.
 */
async function narrate(client, { review, sopTitles = [] }) {
  const lines = (review.lines || []).map((l) => ({
    metric: l.metric,
    rating: l.rating ?? l.ai_rating,
    weight: l.weight,
    evidence: l.ai_evidence || null,
  }));
  const messages = [
    {
      role: "system",
      content: [
        "You write performance review narratives for a line manager to edit. You are given scores and the evidence behind them.",
        "",
        "RULES:",
        "1. Explain the figures you are given. Never state a different score, and never suggest one.",
        "2. Refer only to the evidence provided. Do not infer attitude, effort or intent from a number — 'was late 4 times' is a fact, 'is careless' is not.",
        "3. Where a metric could not be measured, say so plainly. Do not treat it as poor performance.",
        "4. Refer to company policies by the names given; do not restate them.",
        "5. Three short paragraphs: what went well, what needs attention, and what to do next. No headings, no bullet points, no salutation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Employee: ${review.employee_name || "the employee"}`,
        `Cycle: ${review.cycle_name || review.cycle_code} (${review.starts_on} to ${review.ends_on})`,
        review.overall_score !== null && review.overall_score !== undefined
          ? `Overall score: ${review.overall_score}${review.band ? ` — ${review.band}` : ""}`
          : "Overall score: not yet computed",
        "",
        "Scores and evidence:",
        JSON.stringify(lines, null, 1),
        sopTitles.length ? `\nCompany policies: ${sopTitles.join("; ")}` : "",
      ].join("\n"),
    },
  ];

  try {
    const { text, provider } = await llm.chat({ client, messages, temperature: 0.4 });
    const body = String(text || "").trim();
    if (body.length > 120) return { ai_summary: body, ai_model: provider || "ai" };
    logger.warn({ provider }, "[appraisal] narrative too short to be useful — leaving it unset");
  } catch (err) {
    logger.warn({ err }, "[appraisal] narrative failed — the manager writes their own");
  }
  return { ai_summary: null, ai_model: null };
}

async function saveNarrative(client, { id, ai_summary, ai_model, evidence = null }) {
  const { rows } = await client.query(
    `UPDATE appraisal_review SET ai_summary = $2, ai_model = $3,
            ai_evidence = coalesce($4, ai_evidence), updated_at = now()
      WHERE appraisal_review_id = $1 RETURNING *`,
    [id, ai_summary, ai_model, evidence ? JSON.stringify(evidence) : null],
  );
  return rows[0] || null;
}

module.exports = {
  listCycles, getCycle, createCycle, setCycleStatus, CYCLE_TRANSITIONS,
  gather, scoreEmployee,
  listReviews, getReview, mine, upsertReview, submitReview, respond,
  narrate, saveNarrative,
};
