/**
 * The re-baselining scheduler (MOD-31). PURE — no db, no ambient clock.
 *
 * Given a chain, what has actually happened to it, and a target date, this
 * decides every remaining date. It is the whole engine; everything else in the
 * module is plumbing around it. It is pure precisely because this is the part
 * that has to be provable — the tests can drive a vessel four days late through
 * it and assert what the client is told.
 *
 * ── THE THREE DATES ─────────────────────────────────────────────────────────
 *
 *   baseline_due  set once, at instantiation, and never touched again. The
 *                 yardstick. Variance means nothing measured against a number
 *                 that moves with the excuses.
 *   planned_due   the commitment — what the client is told. Moves when work
 *                 runs LATE. Does NOT move when work runs early.
 *   forecast_due  what we actually believe. Moves both ways, freely.
 *
 * The asymmetry is the business rule ("delays push out; early finishes do not
 * pull the promise forward"), and it is unimplementable with one date: an early
 * finish would either have to lie or break the rule. Splitting the commitment
 * from the prediction lets both be honest at once. `earlyCompletion` policy can
 * relax it — PULL_ALWAYS for a tenant who wants the promise to track the
 * forecast, PULL_ON_CONFIRMATION for one who wants a human to confirm the next
 * stage is actually ready to start early.
 *
 * ── THE FOUR GUARDRAILS ─────────────────────────────────────────────────────
 *
 *  1. FROZEN DONE. A completed stage's dates are never recomputed, and its
 *     actual completion becomes the anchor everything after it is measured
 *     from. Recalculation reads only PENDING / IN_PROGRESS work.
 *
 *  2. HARD TARGET LOCK. A stage flagged `isTargetLock` holds its commitment
 *     under upstream slip: the remaining stages are compressed instead. That is
 *     what protects an SLA — and it is also the guardrail most able to lie,
 *     which is what (3) is for.
 *
 *  3. COMPRESSION FLOORS. No stage compresses below `minDurationHours`.
 *     Distribution is water-filling: give each stage its weight share, pin
 *     anything that lands under its floor AT its floor, redistribute what is
 *     left among the rest, repeat. When the floors no longer fit in the horizon
 *     the answer is not a tighter schedule, it is BREACH_FORECAST — reported
 *     early, while somebody can still act. A schedule that always looks
 *     feasible is worth nothing.
 *
 *  4. ATTRIBUTION. Variance is charged to the owner tier of the stage that
 *     SLIPPED, never the stage that revealed it. Get this backwards and every
 *     carrier delay lands on internal ops, because ops owns the delivery stage
 *     that got pushed.
 *
 * ── SEGMENTS ────────────────────────────────────────────────────────────────
 *
 * Warehousing and business representation are not a race to a date. Their
 * chains carry segments: bounded ones (INBOUND / OUTBOUND / MANDATE / RENEWAL)
 * schedule normally with their own anchor and horizon; STEADY stages run on a
 * cadence, carry no weight, take no dates and never read as overdue. Weights
 * sum to 100 WITHIN a segment, which is why every calculation here is
 * per-segment rather than per-chain.
 */
"use strict";

const cal = require("./milestone.calendar");

const HEALTH = {
  OK: "OK",
  DUE: "DUE",
  AT_RISK: "AT_RISK",
  DELAYED: "DELAYED",
  BREACH: "BREACH_FORECAST",
  DONE: "DONE",
  BLOCKED: "BLOCKED",
};

const OUTCOME = {
  NO_CHANGE: "NO_CHANGE",
  SHIFTED: "SHIFTED",
  COMPRESSED: "COMPRESSED",
  BREACH: "BREACH_FORECAST",
  LOCK_RELEASED: "LOCK_RELEASED",
};

/** Tenant-tunable policy; these defaults are the ones documented in the plan. */
const DEFAULT_POLICY = {
  earlyCompletion: "HOLD",        // HOLD | PULL_ON_CONFIRMATION | PULL_ALWAYS
  onFloorReached: "HOLD_AND_ALERT", // HOLD_AND_ALERT | AUTO_RELEASE | REQUIRE_REPLAN
  riskHours: 24,                  // inside this much working time → AT_RISK
  dueHours: 48,                   // inside this much → DUE
};

const isDone = (s) => s.status === "DONE";
const isBlocked = (s) => s.status === "BLOCKED";
const isSteady = (s) => (s.segment || "MAIN") === "STEADY" || !!s.cadence;
const segmentOf = (s) => s.segment || "MAIN";
const asDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);

/**
 * Water-filling distribution of `horizonHours` across stages by weight, with
 * each stage's floor respected.
 *
 * The naïve version — `max(floor, share)` per stage — overshoots the horizon,
 * because every stage lifted to its floor steals time nobody subtracted from
 * the others. Pinning one stage at a time and redistributing the remainder is
 * what keeps the total exact. Returns null when the floors cannot fit at all;
 * that is the caller's breach signal.
 */
function distribute(stages, horizonHours) {
  const floors = stages.reduce((sum, s) => sum + Math.max(0, s.minDurationHours || 0), 0);
  if (floors > horizonHours) return null;

  const pinned = new Map();
  let pool = stages.slice();
  let available = horizonHours;

  for (let guard = 0; guard <= stages.length; guard += 1) {
    const totalWeight = pool.reduce((sum, s) => sum + Math.max(0, s.weight || 0), 0);
    let pinnedOne = false;

    for (const s of pool) {
      const share = totalWeight > 0
        ? (Math.max(0, s.weight || 0) / totalWeight) * available
        : available / pool.length;
      const floor = Math.max(0, s.minDurationHours || 0);
      if (share < floor) {
        pinned.set(s.key, floor);
        available -= floor;
        pool = pool.filter((p) => p.key !== s.key);
        pinnedOne = true;
        break;
      }
    }
    if (!pinnedOne) break;
  }

  const totalWeight = pool.reduce((sum, s) => sum + Math.max(0, s.weight || 0), 0);
  const out = new Map(pinned);
  for (const s of pool) {
    out.set(s.key, totalWeight > 0
      ? (Math.max(0, s.weight || 0) / totalWeight) * available
      : available / (pool.length || 1));
  }
  return out;
}

/** Health of one open stage against its commitment. */
function healthOf(stage, plannedDue, now, policy, breached) {
  if (isDone(stage)) return HEALTH.DONE;
  if (isBlocked(stage)) return HEALTH.BLOCKED;
  if (breached) return HEALTH.BREACH;
  if (!plannedDue) return HEALTH.OK;
  if (now > plannedDue) return HEALTH.DELAYED;
  const spec = policy.calendar;
  const left = cal.workingHoursBetween(spec, now, plannedDue);
  if (left <= policy.riskHours) return HEALTH.AT_RISK;
  if (left <= policy.dueHours) return HEALTH.DUE;
  return HEALTH.OK;
}

/**
 * Recompute a chain.
 *
 * @param {Object}   input
 * @param {Array}    input.stages    ordered; each { key, seq, code, weight,
 *   minDurationHours, ownerTier, isAnchor, isTargetLock, segment, cadence,
 *   status, completedAt, baselineDue, plannedDue, forecastDue,
 *   manualDueOverride }
 * @param {Date}     input.now
 * @param {Date}     input.openedAt  fallback anchor (dossier open date)
 * @param {Date}     [input.targetDate]  promised → eta → duration, resolved by
 *   the caller. Absent means "no horizon" and the chain keeps its offset dates.
 * @param {Object}   [input.calendar] CalendarSpec
 * @param {Object}   [input.policy]
 * @returns {{ stages: Array, meta: Object }}
 */
function computeSchedule({ stages = [], now, openedAt, targetDate = null, calendar, policy = {} } = {}) {
  const spec = calendar || cal.DEFAULT_CALENDAR;
  const pol = { ...DEFAULT_POLICY, ...policy, calendar: spec };
  const nowAt = asDate(now) || new Date();
  const opened = asDate(openedAt) || nowAt;

  const ordered = stages.slice().sort((a, b) => Number(a.seq) - Number(b.seq));
  const bySegment = new Map();
  for (const s of ordered) {
    const seg = segmentOf(s);
    if (!bySegment.has(seg)) bySegment.set(seg, []);
    bySegment.get(seg).push(s);
  }

  const results = [];
  const meta = {
    provisional: false,
    breached: false,
    compressed: false,
    lockReleased: false,
    horizonHours: null,
    floorHours: null,
    segments: {},
  };

  for (const [segment, segStages] of bySegment) {
    // STEADY work runs on a cadence: no horizon, no dates, never overdue.
    if (segment === "STEADY" || segStages.every(isSteady)) {
      for (const s of segStages) {
        results.push({
          key: s.key, code: s.code, segment,
          baselineDue: s.baselineDue || null,
          plannedDue: s.plannedDue || null,
          forecastDue: s.forecastDue || null,
          health: isDone(s) ? HEALTH.DONE : HEALTH.OK,
          outcome: OUTCOME.NO_CHANGE,
          cadence: s.cadence || null,
          steady: true,
        });
      }
      continue;
    }

    // GUARDRAIL 1 — completed work is frozen and becomes the anchor.
    const done = segStages.filter(isDone);
    const open = segStages.filter((s) => !isDone(s));
    const lastDoneAt = done.reduce((latest, s) => {
      const at = asDate(s.completedAt);
      return at && (!latest || at > latest) ? at : latest;
    }, null);
    const anchor = lastDoneAt || opened;

    // The schedule stays provisional until the segment's anchor stage lands —
    // a vessel berths when it berths, and pretending otherwise is what produced
    // the old engine's confidently wrong dates.
    const anchorStage = segStages.find((s) => s.isAnchor);
    const anchorMet = !anchorStage || isDone(anchorStage);
    if (!anchorMet) meta.provisional = true;

    for (const s of done) {
      results.push({
        key: s.key, code: s.code, segment,
        baselineDue: s.baselineDue || null,
        plannedDue: s.plannedDue || null,
        forecastDue: s.forecastDue || null,
        health: HEALTH.DONE,
        outcome: OUTCOME.NO_CHANGE,
        frozen: true,
      });
    }
    if (!open.length) continue;

    // GUARDRAIL 2 — the locked stage's commitment is the horizon's end.
    const locked = open.find((s) => s.isTargetLock);
    const lockedCommitment = locked ? asDate(locked.plannedDue) : null;
    const target = lockedCommitment || asDate(targetDate);

    // No target of any kind: keep whatever the offset fallback produced. The
    // engine does not invent a horizon it was not given.
    //
    // NOTE the condition is `!target` ONLY. A target that has ALREADY passed
    // (the anchor landed after the promised date) is not "no horizon" — it is a
    // breach, and it must fall through to the breach path below. Treating the
    // two the same made an overdue file stop forecasting altogether, which is
    // exactly the moment it most needs to.
    if (!target) {
      for (const s of open) {
        const planned = asDate(s.plannedDue) || asDate(s.baselineDue);
        results.push({
          key: s.key, code: s.code, segment,
          baselineDue: s.baselineDue || null,
          plannedDue: s.plannedDue || null,
          forecastDue: s.forecastDue || s.plannedDue || null,
          health: healthOf(s, planned, nowAt, pol, false),
          outcome: OUTCOME.NO_CHANGE,
          noHorizon: true,
        });
      }
      continue;
    }

    const horizon = cal.workingHoursBetween(spec, anchor, target);

    // THE HORIZON ENDS AT THE LOCKED STAGE, not at the end of the chain.
    //
    // "Delivery by 13 March" is a promise about DELIVERY. Spreading the horizon
    // across every remaining stage puts delivery days EARLY and pushes the
    // administrative tail — empty return, final invoice — past the date the
    // client was given, which reads as a breach of a promise nobody made about
    // those stages. So the horizon is distributed up to and including the lock,
    // and whatever follows continues at the same hours-per-weight rate.
    const lockIdx = open.findIndex((s) => s.isTargetLock);
    const preLock = lockIdx >= 0 ? open.slice(0, lockIdx + 1) : open;
    const postLock = lockIdx >= 0 ? open.slice(lockIdx + 1) : [];

    const floors = preLock.reduce((sum, s) => sum + Math.max(0, s.minDurationHours || 0), 0);
    meta.horizonHours = meta.horizonHours === null ? horizon : Math.min(meta.horizonHours, horizon);
    meta.floorHours = (meta.floorHours || 0) + floors;
    meta.segments[segment] = { horizonHours: horizon, floorHours: floors, anchorMet };

    // GUARDRAIL 3 — the floors do not fit (or the target has already passed).
    // Stop compressing; say so.
    let shares = horizon > 0 ? distribute(preLock, horizon) : null;
    let breached = false;
    let lockReleased = false;

    if (!shares) {
      breached = true;
      meta.breached = true;
      // Every policy still produces a HONEST forecast — each stage at its floor,
      // which runs past the locked date. What differs is what happens to the
      // commitment: hold it (and report the breach), or move it.
      shares = new Map(preLock.map((s) => [s.key, Math.max(0, s.minDurationHours || 0)]));
      if (pol.onFloorReached === "AUTO_RELEASE") {
        lockReleased = true;
        meta.lockReleased = true;
      }
      if (pol.onFloorReached === "REQUIRE_REPLAN") meta.requiresReplan = true;
    } else if (horizon < floors * 1.05) {
      // Fitting only because the floors were honoured is still worth naming:
      // the chain has no slack left and the next slip breaches.
      meta.compressed = true;
    }

    // Stages after the lock continue at the pre-lock rate, floored. They are
    // real work with real durations — they just are not part of the promise.
    if (postLock.length) {
      const preWeight = preLock.reduce((sum, s) => sum + Math.max(0, s.weight || 0), 0);
      const rate = preWeight > 0 && horizon > 0 ? horizon / preWeight : 0;
      for (const s of postLock) {
        shares.set(s.key, Math.max(Math.max(0, s.minDurationHours || 0), Math.max(0, s.weight || 0) * rate));
      }
    }

    let cursor = anchor;
    for (const s of open) {
      const hours = shares.get(s.key) || 0;
      cursor = cal.addWorkingHours(spec, cursor, hours);
      const forecast = asDate(s.manualDueOverride) || cursor;

      const prevPlanned = asDate(s.plannedDue);
      let planned = prevPlanned;
      let outcome = OUTCOME.NO_CHANGE;

      if (!planned) {
        // First scheduling of this stage. A locked stage's commitment IS the
        // target — that is what locking means. Anything else commits the client
        // to the sum of our floors, which is not a promise anyone made.
        planned = s.isTargetLock && target ? target : forecast;
        outcome = OUTCOME.SHIFTED;
      } else if (nowAt > planned) {
        // ALREADY LATE, and still open. The commitment does NOT move: it is the
        // record of a promise now broken, and sliding it forward every time the
        // scanner runs is precisely the blind date-drift this engine exists to
        // prevent — a chain that is permanently "on time" for a date it keeps
        // rewriting. The forecast moves; the promise stands.
        outcome = OUTCOME.NO_CHANGE;
      } else if (s.isTargetLock && !lockReleased) {
        // GUARDRAIL 2 in one line: the commitment does not move, whatever the
        // forecast says. The breach is reported instead.
        outcome = breached ? OUTCOME.BREACH : OUTCOME.NO_CHANGE;
      } else if (forecast > planned) {
        // LATE — the commitment follows the slip.
        planned = forecast;
        outcome = breached ? OUTCOME.BREACH : OUTCOME.SHIFTED;
      } else if (forecast < planned) {
        // EARLY — the forecast improves, the promise does not, unless policy
        // says otherwise.
        if (pol.earlyCompletion === "PULL_ALWAYS") {
          planned = forecast;
          outcome = OUTCOME.SHIFTED;
        } else {
          outcome = OUTCOME.NO_CHANGE;
        }
      }

      if (s.isTargetLock && lockReleased && forecast > (prevPlanned || forecast)) {
        planned = forecast;
        outcome = OUTCOME.LOCK_RELEASED;
      }

      // NO COMMITMENT UPSTREAM OF THE LOCK MAY FALL AFTER THE LOCK ITSELF.
      //
      // Without this the breach path produces an incoherent plan: delivery
      // committed for the 23rd, and the customs clearance that must precede it
      // committed for the 24th. Both statements are individually defensible —
      // the promise held, the upstream stage slipped — and together they are
      // nonsense. The commitment line stays internally consistent and the
      // FORECAST is what runs past the promise. That divergence is the breach,
      // and it is the thing the alert is about.
      if (target && !lockReleased && planned > target && open.indexOf(s) <= (lockIdx < 0 ? -1 : lockIdx)) {
        planned = target;
      }
      if (!breached && shares.get(s.key) <= Math.max(0, s.minDurationHours || 0) && (s.minDurationHours || 0) > 0) {
        meta.compressed = true;
        if (outcome === OUTCOME.NO_CHANGE) outcome = OUTCOME.COMPRESSED;
      }

      results.push({
        key: s.key, code: s.code, segment,
        // GUARDRAIL: the baseline is written once and never again.
        baselineDue: s.baselineDue || forecast,
        plannedDue: planned,
        forecastDue: forecast,
        allocatedHours: hours,
        health: healthOf(s, planned, nowAt, pol, breached),
        outcome,
        atFloor: hours <= Math.max(0, s.minDurationHours || 0) && (s.minDurationHours || 0) > 0,
      });
    }
  }

  const bySeq = new Map(ordered.map((s, i) => [s.key, i]));
  results.sort((a, b) => (bySeq.get(a.key) ?? 0) - (bySeq.get(b.key) ?? 0));
  return { stages: results, meta };
}

/**
 * GUARDRAIL 4 — attribute a completed stage's slip.
 *
 * Charged to the owner tier of THIS stage, because this is the stage that ran
 * long. The tiers whose forecasts move as a consequence are not at fault, and
 * an engine that cannot tell the difference produces a scorecard where internal
 * ops owns every carrier delay.
 *
 * `cause_reason_code` (force majeure — port strike, customs outage) is an
 * override the caller supplies; it is recorded ALONGSIDE the measured variance
 * rather than instead of it, so the excusal is auditable and the raw number
 * survives.
 */
function attributeVariance({ stage, completedAt, calendar, causeReasonCode = null }) {
  const spec = calendar || cal.DEFAULT_CALENDAR;
  const actual = asDate(completedAt) || new Date();
  const against = asDate(stage.plannedDue) || asDate(stage.baselineDue);
  if (!against) return { varianceHours: null, attributedTo: null, causeReasonCode, late: false };

  const late = actual > against;
  const hours = late
    ? cal.workingHoursBetween(spec, against, actual)
    : -cal.workingHoursBetween(spec, actual, against);

  return {
    varianceHours: Math.round(hours),
    // Only a slip is attributed. Charging a tier for finishing early would make
    // the scorecard unreadable — "who is costing us time" is the question.
    attributedTo: late ? (stage.ownerTier || "INTERNAL") : null,
    causeReasonCode: late ? causeReasonCode : null,
    late,
  };
}

module.exports = {
  computeSchedule,
  attributeVariance,
  distribute,
  HEALTH,
  OUTCOME,
  DEFAULT_POLICY,
};
