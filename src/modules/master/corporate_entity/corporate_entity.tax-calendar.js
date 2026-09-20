/**
 * Tax obligation generator (MOD-01, PR-05 / audit CE-16, Decision Q4).
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * The missing half of `tax_calendar`. 0342 created the table and called it a
 * "compliance calendar of statutory obligations (drives reminders/alerts)".
 * 0516 gave it a reason to exist — `tax_registration_id`, `period_code`,
 * `generated` and the WAIVED/SUPERSEDED resting states — and then nothing ever
 * wrote to it: `corporate_entity.repo.taxObligations` was a read, and the
 * dossier rendered whatever a human had typed in. So a registration that says
 * "SLAS files TVA in Cameroon, monthly, by the 15th, Ada owns it" produced
 * exactly nothing, and the calendar the dossier showed was a list somebody had
 * to remember to maintain. This is the generator that reads that sentence and
 * writes the filings.
 *
 * ── THE ONE PROPERTY THAT MATTERS ──────────────────────────────────────────
 *
 * RE-RUNNING IS FREE. This runs nightly and it will also be run by hand —
 * after a deploy, after a failure, after somebody wonders whether it ran at
 * all. Every obligation carries a `generation_key` assembled from the entity,
 * the registration, the obligation kind, the period and the registration's
 * CADENCE, and `ux_tax_calendar_generation_key` (13970) makes it unique. The
 * insert is `ON CONFLICT DO NOTHING`, so a second run inserts nothing rather
 * than handing the accountant the same filing four times. The database
 * enforces it, not the code: two overlapping runs, or a bug in the "have I
 * already generated this?" logic, still cannot produce a duplicate.
 *
 * Putting the cadence IN the key is the part that looks odd and is doing real
 * work. When a registration's `filing_due_day` moves from 20 to 15, the key
 * changes, so the generator writes a new obligation dated the 15th and
 * SUPERSEDES the one dated the 20th — leaving an audited record that the
 * deadline moved — instead of quietly leaving an obligation dated the way the
 * registration no longer reads.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 *
 * It never rewrites an obligation a person has already acted on. DONE, LATE
 * and WAIVED rows are history: you cannot un-file a return, and a waived one
 * was waived by a human for a reason the generator does not get to overrule.
 * Only PENDING generated rows are ever superseded.
 *
 * It never invents a responsible person. An obligation inherits its
 * registration's `responsible_user_id`; when the registration has none the
 * obligation has none, and the run reports it as a finding. Guessing an owner
 * for a statutory filing is worse than admitting nobody has been assigned.
 *
 * It never hard-blocks. An overdue filing is an event and a LATE status, which
 * is a fact for a person to act on — the same posture
 * `corporate_entity.renewals.js` holds, and the reason is the same: a system
 * that freezes invoicing because a declaration is late has made an operational
 * judgement it is not entitled to make.
 *
 * It does not decide statutory deadlines. Where a registration is silent about
 * frequency or due day, `JURISDICTION_RULES` supplies a DEFAULT so generation
 * can proceed, and the run reports that a default was used. Those defaults are
 * this tenant's working assumption, not a statement of law; the registration
 * is authoritative and always wins over them.
 *
 * ── STATUTORY REGISTRATIONS ARE NOT THIS MODULE'S PROBLEM ──────────────────
 *
 * Generation reads `entity_tax_registration.is_active` / `deregistered_on`,
 * which is a real lifecycle. The statutory `entity_registration` row has no
 * such state, and this file does not invent one: which statutory registration
 * is "current" is settled by
 * doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md (PR-03), consumed by
 * `corporate_entity.renewals.selectedRegistrations`. Nothing here selects,
 * orders or filters `entity_registration` rows.
 */
"use strict";

const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const events = require("./corporate_entity.events");
// The reminder sweep's SELECT lives with the rest of the module's SQL.
const repo = require("./corporate_entity.repo");
const { AppError } = require("../../../utils/errors");
const metrics = require("../../../shared/observability/metrics");

const MODULE = "MOD-01";
const ref = (id) => "corporate_entity:" + id;

/*
 * PR-10 / B.3: the generator's SUMMARY was the only record of what a run did,
 * and it went to whichever caller logged it. Each outcome now also increments
 * a counter, so a dashboard can answer "is the calendar actually being
 * filled?" without reading job logs — and a `generated` counter that never
 * moves catches a generator that stopped running, which is the failure mode
 * this module cannot afford (§9 line 6: idempotent generation, silently
 * expected to work every night).
 *
 * Emitted AFTER the run's writes, never inside the transaction: a counter is
 * a fact about what was done, and a ROLLBACK means it was not done.
 */
const OBLIGATION_METRIC = (result, value = 1) => {
  if (!Number(value)) return; // a zero is not an outcome — see the outbox's RECONCILE_METRIC
  metrics.inc(
    "praxis_tax_obligations_total",
    { result },
    value,
    "Tax obligation lifecycle outcomes: generated by the nightly run, skipped as duplicates (idempotent re-run), superseded by a closing registration or a changed cadence, waived by hand.",
  );
};

/* ── Date arithmetic ────────────────────────────────────────────────────────
 *
 * Every date here is a calendar date with no time on it, handled in UTC and
 * formatted as YYYY-MM-DD, for the same reason `corporate_entity.renewals.js`
 * does it that way: `due_on` is a `date` column, and mixing a local-timezone
 * Date into one shifts the filing by a day either side of midnight depending on
 * where the worker happens to run.
 */

/** A `date` column as YYYY-MM-DD. pg hands back a Date; a string stays a string. */
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

const firstOfMonth = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;

/** Last day of a 1-based month. Day 0 of the next month is the last of this one. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const lastOfMonth = (year, month) =>
  `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

/** Add (or subtract) whole months, carrying the year. */
function shiftMonth(year, month, n) {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * A day-of-month clamped to the month it lands in.
 *
 * THE MONTH-END CASE, and the reason this is a function rather than an
 * expression: a registration that says "file by the 31st" is not wrong, it is
 * a tenant saying "end of month". April has 30 days and February 28 or 29, so
 * the 31st of those months is a date that does not exist. Rolling forward into
 * the next month would put the filing in the wrong period; silently using the
 * 1st would move it a month early. Clamping to the last day of the month is
 * the only answer that keeps the obligation in the period it belongs to.
 */
function clampDay(year, month, day) {
  const d = Math.min(Math.max(1, Math.trunc(Number(day) || 1)), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

const yearOf = (iso) => Number(iso.slice(0, 4));
const monthOf = (iso) => Number(iso.slice(5, 7));

/* ── Cadence ────────────────────────────────────────────────────────────────
 *
 * `entity_tax_registration.filing_frequency` is an enum from 0516. ON_EVENT is
 * in it and is honestly not schedulable — a customs duty that arises when a
 * shipment clears has no period, so there is nothing to generate. That is
 * reported as a finding rather than being skipped silently, because a
 * registration the generator quietly ignored looks identical to one it has not
 * been told about yet.
 */
const FREQUENCIES = ["MONTHLY", "BIMONTHLY", "QUARTERLY", "ANNUAL", "ON_EVENT"];
const PERIOD_MONTHS = { MONTHLY: 1, BIMONTHLY: 2, QUARTERLY: 3, ANNUAL: 12 };

/**
 * How many months after the period ENDS the filing falls due, by cadence.
 *
 * A VAT return is filed for a period that has closed, so its due date sits in
 * the following month; an annual return sits further out still. This is a
 * property of the cadence rather than of a jurisdiction, which is why it lives
 * here and not in the rules below — a jurisdiction overrides the DAY, not the
 * relationship between a period and its own deadline.
 */
const DUE_MONTH_OFFSET = { MONTHLY: 1, BIMONTHLY: 1, QUARTERLY: 1, ANNUAL: 3 };

/**
 * The obligation code a (tax kind, cadence) pair files, using the vocabulary
 * 0342 itself declared for `tax_calendar.obligation`
 * ('VAT_RETURN' | 'DIPE' | 'DSF' | 'IS_INSTALMENT') extended to the kinds 0516
 * allows a registration to carry. The column is `text`, not an enum, precisely
 * so this vocabulary can grow without a migration.
 */
function obligationKindFor(taxKind, frequency) {
  const kind = String(taxKind || "OTHER").toUpperCase();
  if (kind === "INCOME") return frequency === "ANNUAL" ? "IS_RETURN" : "IS_INSTALMENT";
  return (
    {
      VAT: "VAT_RETURN",
      WHT: "WHT_RETURN",
      PAYROLL: "PAYROLL_RETURN",
      CUSTOMS: "CUSTOMS_RETURN",
      LOCAL: "LOCAL_TAX_RETURN",
    }[kind] || "TAX_RETURN"
  );
}

/**
 * Per-jurisdiction defaults, used ONLY for what a registration leaves blank.
 *
 * These are this tenant's working assumptions so that a registration saved
 * without a cadence still produces a calendar rather than vanishing from it —
 * not a statement of any jurisdiction's law. A registration's own
 * `filing_frequency` / `filing_due_day` always wins, and the run reports
 * whenever a default was substituted, because an obligation generated from an
 * assumption has to be distinguishable from one generated from a fact.
 *
 * `obligation` may override the derived code, which is how Cameroon's DSF and
 * DIPE — the annual declarations 0342 named — are produced from an INCOME
 * registration without a second lookup table.
 */
const GENERIC_RULE = { filing_frequency: "MONTHLY", filing_due_day: 20, due_month_offset: null };

const JURISDICTION_RULES = {
  // Cameroon (OHADA/CEMAC). DSF/DIPE are 0342's own obligation vocabulary.
  CM: {
    filing_frequency: "MONTHLY",
    filing_due_day: 15,
    currency: "XAF",
    byKind: {
      VAT: { filing_frequency: "MONTHLY", filing_due_day: 15 },
      PAYROLL: { filing_frequency: "MONTHLY", filing_due_day: 15 },
      WHT: { filing_frequency: "MONTHLY", filing_due_day: 15 },
      INCOME: {
        filing_frequency: "ANNUAL",
        filing_due_day: 15,
        obligation: (regime) => (String(regime || "").toUpperCase() === "SIMPLIFIE" ? "DIPE" : "DSF"),
      },
    },
  },
  // France / EU.
  FR: {
    filing_frequency: "MONTHLY",
    filing_due_day: 20,
    currency: "EUR",
    byKind: {
      VAT: { filing_frequency: "MONTHLY", filing_due_day: 20 },
      PAYROLL: { filing_frequency: "MONTHLY", filing_due_day: 15 },
      INCOME: { filing_frequency: "ANNUAL", filing_due_day: 15 },
    },
  },
};

/** The jurisdiction rule for a registration, or the generic one. */
function jurisdictionRuleFor(countryCode, taxKind) {
  const country = JURISDICTION_RULES[String(countryCode || "").toUpperCase()];
  if (!country) return { ...GENERIC_RULE, source: "generic" };
  const byKind = (country.byKind && country.byKind[String(taxKind || "").toUpperCase()]) || null;
  return {
    filing_frequency: (byKind && byKind.filing_frequency) || country.filing_frequency,
    filing_due_day: (byKind && byKind.filing_due_day) || country.filing_due_day,
    due_month_offset: (byKind && byKind.due_month_offset) || null,
    obligation: (byKind && byKind.obligation) || null,
    currency: country.currency || null,
    source: byKind ? "jurisdiction_kind" : "jurisdiction",
  };
}

/**
 * The cadence a registration actually files on, and where each part came from.
 *
 * Returns `schedulable: false` with a `reason` when there is nothing to
 * generate: an ON_EVENT registration, or one so blank that not even a
 * jurisdiction default can place it. The caller reports those instead of
 * dropping them, so "why is this registration not on the calendar" has an
 * answer.
 */
function resolveCadence(registration) {
  const rule = jurisdictionRuleFor(registration.country_code, registration.tax_kind);
  const ownFrequency = registration.filing_frequency
    ? String(registration.filing_frequency).toUpperCase()
    : null;
  const frequency = ownFrequency || rule.filing_frequency || null;

  if (!frequency || !FREQUENCIES.includes(frequency)) {
    return { schedulable: false, reason: "unknown_filing_frequency", frequency: null };
  }
  if (frequency === "ON_EVENT") {
    return { schedulable: false, reason: "on_event_has_no_period", frequency };
  }

  const ownDueDay =
    registration.filing_due_day === null || registration.filing_due_day === undefined || registration.filing_due_day === ""
      ? null
      : Number(registration.filing_due_day);
  const dueDay = Number.isFinite(ownDueDay) ? ownDueDay : rule.filing_due_day;
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) {
    return { schedulable: false, reason: "no_filing_due_day", frequency };
  }

  const obligation =
    (rule.obligation && rule.obligation(registration.regime)) ||
    obligationKindFor(registration.tax_kind, frequency);

  return {
    schedulable: true,
    frequency,
    due_day: dueDay,
    due_month_offset: rule.due_month_offset || DUE_MONTH_OFFSET[frequency],
    obligation,
    // Which parts were assumed. Surfaced on the generated obligation's payload
    // and in the run summary so an obligation resting on a default is legible.
    defaults_used: {
      filing_frequency: ownFrequency ? null : rule.filing_frequency,
      filing_due_day: Number.isFinite(ownDueDay) ? null : rule.filing_due_day,
    },
  };
}

/* ── Periods ────────────────────────────────────────────────────────────────
 *
 * A period is what an obligation is FOR, as distinct from `due_on`, which is
 * when it must be filed. Storing both is what makes "have I generated March
 * yet?" a question about dates rather than about parsing a label back apart.
 */

/** The calendar periods of `frequency` that overlap [from, to], inclusive. */
function periodsFor(frequency, fromIso, toIso) {
  const span = PERIOD_MONTHS[frequency];
  if (!span) return []; // ON_EVENT: no period exists to enumerate.

  const out = [];
  let year = yearOf(fromIso);
  // Align the cursor to the first period boundary at or before `from`, so a
  // window starting mid-quarter still yields the quarter it falls inside.
  const startMonth = monthOf(fromIso);
  let month = startMonth - ((startMonth - 1) % span) || 1;
  if (month < 1) month = 1;

  while (true) {
    const periodStart = firstOfMonth(year, month);
    const endShift = shiftMonth(year, month, span - 1);
    const periodEnd = lastOfMonth(endShift.year, endShift.month);
    if (periodStart > toIso) break;
    if (periodEnd >= fromIso) {
      out.push({ period_code: periodCode(frequency, year, month, span), period_start: periodStart, period_end: periodEnd });
    }
    const next = shiftMonth(year, month, span);
    year = next.year;
    month = next.month;
    // A generation window is months wide, so this bound is only reachable from
    // a corrupted `from`/`to` pair. Tripping is the point: an unbounded loop
    // over a nonsense window is a hung worker, and a hung worker is a queue
    // nobody notices is stopped.
    if (out.length > 4800) {
      throw new AppError("GENERATION_WINDOW_TOO_LARGE", "The tax generation window is unreasonably large", 500);
    }
  }
  return out;
}

/** The label a person reads on the obligation. */
function periodCode(frequency, year, month, span) {
  if (frequency === "MONTHLY") return `${year}-${String(month).padStart(2, "0")}`;
  if (frequency === "ANNUAL") return `${year}`;
  const index = Math.floor((month - 1) / span) + 1;
  if (frequency === "QUARTERLY") return `${year}-Q${index}`;
  if (frequency === "BIMONTHLY") return `${year}-B${index}`;
  return `${year}-P${index}`;
}

/**
 * The date the filing for `period` falls due.
 *
 * The due month is `due_month_offset` months after the month the period ENDS
 * — a return is filed for a period that has closed — and the day is clamped to
 * that month's length, which is where a "file by the 31st" registration meets
 * February.
 */
function dueDateFor(period, { frequency, due_day, due_month_offset }) {
  const endYear = yearOf(period.period_end);
  const endMonth = monthOf(period.period_end);
  const offset = due_month_offset || DUE_MONTH_OFFSET[frequency] || 1;
  const due = shiftMonth(endYear, endMonth, offset);
  return clampDay(due.year, due.month, due_day);
}

/**
 * The idempotency key. THE contract of this module: same inputs, same key,
 * therefore no second row — see `ux_tax_calendar_generation_key` (13970).
 *
 * Cadence is part of it deliberately. See the module header.
 */
function generationKeyFor({ entityId, taxRegistrationId, obligation, periodCode: code, frequency, dueDay }) {
  return [entityId, taxRegistrationId, obligation, code, frequency, dueDay].join("|");
}

/* ── What "open" means ───────────────────────────────────────────────────────
 *
 * A registration generates obligations while it is registered. 0516 gives it
 * two independent off-switches and both have to be honoured: `is_active=false`
 * is "we are not using this registration" and `deregistered_on` is "the
 * authority closed it on this date". A registration can be active with a
 * FUTURE deregistration — a closure that has been notified but has not
 * happened — and that one still files for the periods it was registered for.
 */
function registrationState(registration, today) {
  if (registration.is_active === false) return { open: false, reason: "registration_inactive" };
  const off = isoDate(registration.deregistered_on);
  if (off && off < today) return { open: false, reason: "registration_deregistered", closed_on: off };
  return { open: true, closes_on: off || null };
}

/* ── Generation ──────────────────────────────────────────────────────────────
 *
 * How far either side of today one run reaches. Backfill is one period so a
 * filing whose deadline passed last week is still generated and marked LATE —
 * a generator that only ever looks forward would make a missed deadline
 * invisible, which is the failure mode the whole module exists to prevent.
 * Horizon is three periods so the calendar shows next quarter rather than
 * tomorrow, which is what makes it worth opening.
 */
const DEFAULT_BACKFILL_PERIODS = 1;
const DEFAULT_HORIZON_PERIODS = 3;

/**
 * Generate (or reconcile) the obligations for one entity's tax registrations.
 *
 * Runs in the caller's transaction if one is open, else its own — `own`
 * defaults to true because the per-entity boundary is the useful one: a
 * tenant-wide sweep should not lose nine entities' calendars because the tenth
 * had a bad row.
 *
 * @returns {Promise<object>} counts, the findings a human needs to see, and
 *          the rows created — never a silent success.
 */
async function generateForEntity(client, entityId, opts = {}) {
  const {
    today = new Date().toISOString().slice(0, 10),
    backfill = DEFAULT_BACKFILL_PERIODS,
    horizon = DEFAULT_HORIZON_PERIODS,
    actor = {},
    own = true,
  } = opts;

  const entity = await repo.get(client, entityId);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);

  const registrations = await repo.taxRegistrationsForGeneration(client, entityId);

  const summary = {
    entity_id: entityId,
    as_of: today,
    registrations: registrations.length,
    created: 0,
    existing: 0,
    superseded: 0,
    marked_late: 0,
    unassigned: 0,
    skipped: [],
    created_rows: [],
  };

  if (own) await client.query("BEGIN");
  try {
    /*
     * Resolve the actor ONCE, here, rather than binding `actor.user_id` into
     * each write (DATA 2.4 — `scripts/check-actor-fk-guard.js`). Identity is
     * pinned to the LIVE schema while the business write may land in SANDBOX,
     * where that user does not exist, so a raw id raises 23503 and takes the
     * whole generation run with it. The repo guards its own columns with a
     * sub-select as a second line of defence; resolving here is the part the
     * gate can see, and it costs one lookup per run instead of one per
     * obligation. Null for a scheduled run, which is the honest answer — the
     * worker is not a person and must not be filed under one's name.
     */
    const actorUserId = await resolveActorId(client, actor.user_id);

    for (const reg of registrations) {
      const state = registrationState(reg, today);

      // A closed registration keeps its history and loses its future. Nothing
      // else is generated for it, and every OPEN generated obligation it still
      // has — PENDING or LATE — is superseded: a filing for a number the
      // authority has closed is a task nobody can perform, and leaving it open
      // would have the reminder engine asking for it forever. DONE and WAIVED
      // are left alone, because both are things a person already did.
      if (!state.open) {
        const closed = await supersedeOpen(client, reg.tax_registration_id, {
          reason: state.reason,
          actorUserId,
          today,
        });
        summary.superseded += closed.length;
        continue;
      }

      const cadence = resolveCadence(reg);
      if (!cadence.schedulable) {
        summary.skipped.push({
          tax_registration_id: reg.tax_registration_id,
          country_code: reg.country_code || null,
          tax_kind: reg.tax_kind || null,
          reason: cadence.reason,
        });
        continue;
      }

      // The window: back up `backfill` periods from the current one so a
      // deadline that just passed is still generated, and forward `horizon` so
      // the calendar shows what is coming. A registration's own
      // `registered_on` clips the lower edge — nothing is generated for a
      // period that predates the number.
      const span = PERIOD_MONTHS[cadence.frequency];
      const lower = shiftMonth(yearOf(today), monthOf(today), -span * backfill);
      let windowStart = firstOfMonth(lower.year, lower.month);
      const registeredOn = isoDate(reg.registered_on);
      if (registeredOn && registeredOn > windowStart) windowStart = registeredOn;

      const upper = shiftMonth(yearOf(today), monthOf(today), span * horizon);
      const windowEnd = lastOfMonth(upper.year, upper.month);

      const expected = [];
      for (const period of periodsFor(cadence.frequency, windowStart, windowEnd)) {
        // A period the registration will have closed by the time it ends is
        // still filed for — you owe the return for the part of it you were
        // registered. One that has not started yet is not owed at all.
        if (state.closes_on && period.period_start >= state.closes_on) continue;

        const key = generationKeyFor({
          entityId,
          taxRegistrationId: reg.tax_registration_id,
          obligation: cadence.obligation,
          periodCode: period.period_code,
          frequency: cadence.frequency,
          dueDay: cadence.due_day,
        });
        expected.push({
          key,
          obligation: cadence.obligation,
          due_on: dueDateFor(period, cadence),
          period,
          // Inherit the registration's owner. Deliberately NOT defaulted: an
          // obligation nobody has been told about is a finding, and the run
          // reports it rather than quietly giving a statutory filing to a
          // person who never agreed to it.
          responsible_user_id: reg.responsible_user_id || null,
          cadence,
        });
      }

      const keys = expected.map((e) => e.key);
      for (const row of expected) {
        // Null means the key already existed — the re-run case. Counted
        // separately from `created` because the difference between "I generated
        // twelve filings" and "twelve filings already existed" is the whole
        // point of the run summary.
        const inserted = await repo.insertObligation(client, {
          entity_id: entityId,
          obligation: row.obligation,
          due_on: row.due_on,
          tax_registration_id: reg.tax_registration_id,
          period_code: row.period.period_code,
          generation_key: row.key,
          period_start: row.period.period_start,
          period_end: row.period.period_end,
          responsible_user_id: row.responsible_user_id,
          created_by: actorUserId,
        });
        if (inserted) {
          summary.created += 1;
          if (!row.responsible_user_id) summary.unassigned += 1;
          summary.created_rows.push({
            tax_calendar_id: inserted.tax_calendar_id,
            obligation: row.obligation,
            period_code: row.period.period_code,
            due_on: row.due_on,
            responsible_user_id: row.responsible_user_id,
          });
        } else {
          summary.existing += 1;
        }
      }

      // Reconcile: an open generated obligation for this registration whose
      // key is no longer expected has been overtaken — the cadence changed, or
      // the window moved past a deregistration. Supersede it and point at what
      // replaced it, so the pair reads as one decision rather than a gap.
      const overtaken = await supersedeUnexpected(client, reg.tax_registration_id, {
        keys,
        windowStart,
        windowEnd,
        reason: state.closes_on ? "registration_deregistered" : "cadence_changed",
        actorUserId,
      });
      summary.superseded += overtaken.length;
    }

    // Anything still PENDING whose deadline has passed is LATE. Advisory: a
    // status and an event, never a block.
    const late = await repo.markOverdue(client, entityId, today, { actorUserId });
    summary.marked_late = late.length;

    for (const row of late) {
      await emitEvent(client, {
        eventTypeKey: events.TAX_OBLIGATION_OVERDUE,
        moduleKey: MODULE,
        entityRef: ref(entityId),
        priority: "HIGH",
        actorUserId,
        payload: {
          tax_calendar_id: row.tax_calendar_id,
          obligation: row.obligation,
          period_code: row.period_code,
          due_on: isoDate(row.due_on),
          days_late: daysBetween(isoDate(row.due_on), today),
          responsible_user_id: row.responsible_user_id || null,
        },
      });
    }

    await emitEvent(client, {
      eventTypeKey: events.TAX_OBLIGATION_GENERATED,
      moduleKey: MODULE,
      entityRef: ref(entityId),
      actorUserId,
      payload: {
        as_of: today,
        registrations: summary.registrations,
        created: summary.created,
        existing: summary.existing,
        superseded: summary.superseded,
        marked_late: summary.marked_late,
        unassigned: summary.unassigned,
        skipped: summary.skipped,
        horizon_periods: horizon,
        backfill_periods: backfill,
      },
    });

    await audit(client, {
      actorUserId,
      action: "tax_obligation.generated",
      moduleKey: MODULE,
      entityRef: ref(entityId),
      after: {
        as_of: today,
        created: summary.created,
        existing: summary.existing,
        superseded: summary.superseded,
        marked_late: summary.marked_late,
        unassigned: summary.unassigned,
        skipped: summary.skipped,
      },
    });

    if (own) await client.query("COMMIT");
  } catch (err) {
    if (own) await client.query("ROLLBACK");
    throw err;
  }

  OBLIGATION_METRIC("generated", summary.created);
  OBLIGATION_METRIC("duplicate_skipped", summary.existing);

  return summary;
}

/**
 * Supersede every open generated obligation on one registration.
 *
 * Used when the registration itself closes. `status_changed_by` records the
 * actor where there was one and stays null for a scheduled run, so a
 * machine-made transition is not filed under a person's name.
 */
async function supersedeOpen(client, taxRegistrationId, { reason, actorUserId = null, today = null } = {}) {
  const rows = await repo.supersedeOpenForRegistration(client, taxRegistrationId, { reason, actorUserId });
  if (rows.length) {
    await audit(client, {
      actorUserId,
      action: "tax_obligation.superseded",
      moduleKey: MODULE,
      entityRef: "entity_tax_registration:" + taxRegistrationId,
      after: { reason, count: rows.length, superseded_on: today },
    });
    OBLIGATION_METRIC("superseded", rows.length);
  }
  return rows;
}

/**
 * Supersede the open generated obligations on one registration whose
 * `generation_key` is no longer expected inside a window.
 *
 * Scoped to the window on purpose: obligations outside it were not considered
 * by this run and must not be swept up by it. Rows a person already acted on
 * (DONE, WAIVED) are never touched — see the module header.
 */
async function supersedeUnexpected(client, taxRegistrationId, { keys, windowStart, windowEnd, reason, actorUserId = null }) {
  const rows = await repo.supersedeUnexpectedForRegistration(client, taxRegistrationId, {
    keys, windowStart, windowEnd, reason, actorUserId,
  });
  if (rows.length) {
    await audit(client, {
      actorUserId,
      action: "tax_obligation.superseded",
      moduleKey: MODULE,
      entityRef: "entity_tax_registration:" + taxRegistrationId,
      after: { reason, count: rows.length, generation_keys: rows.map((r) => r.generation_key) },
    });
    OBLIGATION_METRIC("superseded", rows.length);
  }
  return rows;
}

/* ── Reminders ───────────────────────────────────────────────────────────────
 *
 * A descending ladder rather than a single "you have N days" message: a filing
 * is worth mentioning at a month, worth chasing at a week, and worth chasing
 * harder the day before. `last_reminder_step` is the watermark that makes each
 * rung fire once — the same reason `contract-lapse` dedupes on its own window,
 * because a warning that arrives every morning for thirty days is a warning
 * everybody has learned to filter.
 */
const REMINDER_LADDER = [
  { step: "D30", within: 30 },
  { step: "D14", within: 14 },
  { step: "D7", within: 7 },
  { step: "D1", within: 1 },
];

/**
 * The rung an obligation is currently on, or null when it is too far off.
 *
 * The DEEPEST rung reached, not the first rung that matches — the ladder is
 * scanned from D1 upwards for that reason. Six days out is inside the D7
 * window, and reporting it as D30 would look like "nothing has changed" to the
 * watermark and send nothing at all.
 */
function reminderStepFor(daysUntilDue) {
  if (daysUntilDue === null || daysUntilDue < 0) return null; // overdue is LATE, not a reminder
  for (let i = REMINDER_LADDER.length - 1; i >= 0; i -= 1) {
    if (daysUntilDue <= REMINDER_LADDER[i].within) return REMINDER_LADDER[i];
  }
  return null;
}

/**
 * Emit one reminder per open obligation that has entered a rung it has not
 * already been reminded on. Tenant-wide: the scheduler fans out per tenant, not
 * per entity.
 */
async function remindOpen(client, opts = {}) {
  const {
    today = new Date().toISOString().slice(0, 10),
    // Long enough to cover the top rung of the ladder; a wider window is
    // pointless because `reminderStepFor` returns null past D30 anyway.
    days = REMINDER_LADDER[0].within,
    actor = {},
  } = opts;

  const rows = await repo.obligationsDueWithin(client, { today, days });
  // `emitEvent` guards its own actor column, so a raw id here would degrade to
  // null rather than fail — resolved anyway, for the same reason the generator
  // does it, so every actor this module attributes is one that exists.
  const actorUserId = await resolveActorId(client, actor.user_id);

  let reminded = 0;
  for (const row of rows) {
    // Named for what it is rather than `days`, which is the sweep WINDOW above:
    // the two are different numbers and shadowing one with the other is how a
    // reminder gets sent on the wrong rung.
    const daysUntilDue = daysBetween(today, isoDate(row.due_on));
    const rung = reminderStepFor(daysUntilDue);
    if (!rung) continue;
    // Already told them at this rung. The ladder only descends, so "a
    // different rung" is a sufficient watermark — no per-step table needed.
    if (row.last_reminder_step === rung.step) continue;

    await emitEvent(client, {
      eventTypeKey: events.TAX_OBLIGATION_REMINDER,
      moduleKey: MODULE,
      entityRef: ref(row.entity_id),
      // Close enough that "we will get to it" stops being true.
      priority: rung.within <= 7 ? "HIGH" : "NORMAL",
      actorUserId,
      payload: {
        tax_calendar_id: row.tax_calendar_id,
        obligation: row.obligation,
        period_code: row.period_code,
        due_on: isoDate(row.due_on),
        days_until_due: daysUntilDue,
        step: rung.step,
        entity_code: row.entity_code,
        entity_name: row.entity_name,
        tax_kind: row.tax_kind || null,
        country_code: row.country_code || null,
        filing_portal_url: row.filing_portal_url || null,
        responsible_user_id: row.responsible_user_id || null,
        responsible_name: row.responsible_name || null,
        // The one finding a reminder must carry: an obligation with nobody
        // assigned to it will not be filed by anyone in particular.
        unassigned: row.responsible_user_id === null,
      },
    });

    await repo.markReminded(client, row.tax_calendar_id, rung.step);
    reminded += 1;
  }

  return { as_of: today, considered: rows.length, reminded };
}

/* ── Manual transitions ──────────────────────────────────────────────────────
 *
 * The audit's "audited manual overrides where needed". SUPERSEDED is
 * deliberately NOT reachable from here: it means "the generator's own plan was
 * overtaken", and letting a person assert it would make the reconciliation
 * above ambiguous about whether a row was replaced or merely declared
 * replaced. A filing that will not happen is WAIVED, by a named person, for a
 * written reason.
 */
const MANUAL_STATUSES = ["PENDING", "DONE", "WAIVED"];

async function setStatus(client, taxCalendarId, { status, reason = null, actor = {} }) {
  const target = String(status || "").toUpperCase();
  if (!MANUAL_STATUSES.includes(target)) {
    throw new AppError(
      "BAD_STATUS",
      `A tax obligation cannot be set to ${status || "(nothing)"} by hand. Use ${MANUAL_STATUSES.join(" or ")}; SUPERSEDED is written by the generator.`,
      422,
    );
  }
  // A waiver is a decision with consequences, and the consequence is that the
  // filing will never be chased again. Without a reason there is nothing for
  // the next person to read at the point they wonder why.
  if (target === "WAIVED" && !String(reason || "").trim()) {
    throw new AppError("MISSING_VALUE", "Say why the obligation is being waived.", 422);
  }

  const row = await repo.obligationById(client, taxCalendarId);
  if (!row) throw new AppError("NOT_FOUND", "Tax obligation not found", 404);

  const actorUserId = await resolveActorId(client, actor.user_id);
  const after = await repo.setObligationStatus(client, taxCalendarId, {
    status: target, reason: reason || null, actorUserId,
  });

  await emitEvent(client, {
    eventTypeKey: events.TAX_OBLIGATION_STATUS_CHANGED,
    moduleKey: MODULE,
    entityRef: ref(after.entity_id),
    actorUserId,
    payload: {
      tax_calendar_id: after.tax_calendar_id,
      obligation: after.obligation,
      period_code: after.period_code,
      from: row.status,
      to: after.status,
      reason: after.status_reason || null,
    },
  });
  await audit(client, {
    actorUserId,
    action: "tax_obligation.status_changed",
    moduleKey: MODULE,
    entityRef: ref(after.entity_id),
    before: { status: row.status, status_reason: row.status_reason || null },
    after: { status: after.status, status_reason: after.status_reason || null },
  });

  // A waiver is the one manual outcome worth its own line on a dashboard: it
  // is a decision that a statutory filing will never be chased again, and the
  // reason it requires is recorded above. DONE is routine by comparison.
  if (target === "WAIVED") OBLIGATION_METRIC("waived");

  return after;
}

/**
 * Assign the person who files it. "Assign OR inherit": the generator inherits
 * from the registration, this is the override — a filing can be delegated for
 * one quarter without re-assigning the whole registration.
 */
async function assign(client, taxCalendarId, { responsible_user_id = null, actor = {} }) {
  const row = await repo.obligationById(client, taxCalendarId);
  if (!row) throw new AppError("NOT_FOUND", "Tax obligation not found", 404);

  // 13970 could not put a FOREIGN KEY on `responsible_user_id` — `tax_calendar`
  // pre-exists and the 13791 rule allows it plain columns only — so an unknown
  // id resolves to NULL rather than raising. The resolution therefore happens
  // BEFORE the write and not after: checking the returned row would mean the
  // UPDATE had already stored NULL, and the filing the caller meant to
  // re-assign would be left un-assigned by the very call that refused to
  // re-assign it. `resolveActorId` is the generic "does this user exist in this
  // schema" check, which is also the DATA 2.4 guard.
  const assigneeId = await resolveActorId(client, responsible_user_id);
  if (responsible_user_id && !assigneeId) {
    // A filing silently left un-assigned is exactly the finding this module
    // reports when nobody chose an owner; a typo must not be able to produce
    // it as a side effect.
    throw new AppError("NOT_FOUND", "That user does not exist in this tenant", 404);
  }

  const actorUserId = await resolveActorId(client, actor.user_id);
  const after = await repo.setObligationResponsible(client, taxCalendarId, {
    responsibleUserId: assigneeId,
  });

  await audit(client, {
    actorUserId,
    action: "tax_obligation.assigned",
    moduleKey: MODULE,
    entityRef: ref(after.entity_id),
    before: { responsible_user_id: row.responsible_user_id || null },
    after: { responsible_user_id: after.responsible_user_id || null },
  });
  return after;
}

/** Every entity the generator should visit: those with at least one registration. */
const entitiesWithRegistrations = (client) => repo.entitiesWithRegistrations(client);

/**
 * Sweep every entity with a tax registration.
 *
 * One transaction PER ENTITY rather than one for the tenant: a single bad
 * registration must not cost nine other entities their calendars, and the
 * failures are collected rather than thrown so the run reports what it could
 * not do. The scheduler logs the summary.
 */
async function generateAll(client, opts = {}) {
  const {
    today = new Date().toISOString().slice(0, 10),
    backfill = DEFAULT_BACKFILL_PERIODS,
    horizon = DEFAULT_HORIZON_PERIODS,
    actor = {},
  } = opts;
  const entities = await entitiesWithRegistrations(client);

  const out = {
    as_of: today,
    entities: entities.length,
    created: 0,
    existing: 0,
    superseded: 0,
    marked_late: 0,
    unassigned: 0,
    skipped: 0,
    failed: [],
  };

  for (const e of entities) {
    try {
      const s = await generateForEntity(client, e.entity_id, { today, backfill, horizon, actor });
      out.created += s.created;
      out.existing += s.existing;
      out.superseded += s.superseded;
      out.marked_late += s.marked_late;
      out.unassigned += s.unassigned;
      out.skipped += s.skipped.length;
    } catch (err) {
      // Reported, not swallowed: a tenant where one entity cannot generate has
      // a defect, and a run that returns a clean summary over it hides it.
      out.failed.push({ entity_id: e.entity_id, code: e.code, error: err.message });
    }
  }

  return out;
}

module.exports = {
  // Generation
  generateForEntity,
  generateAll,
  entitiesWithRegistrations,
  // Reconciliation
  supersedeOpen,
  supersedeUnexpected,
  // Reminders
  remindOpen,
  reminderStepFor,
  // Manual transitions
  setStatus,
  assign,
  // Pure rules — exported for the unit tests and for the renewal/360 surfaces
  resolveCadence,
  jurisdictionRuleFor,
  obligationKindFor,
  periodsFor,
  periodCode,
  dueDateFor,
  generationKeyFor,
  registrationState,
  daysInMonth,
  clampDay,
  shiftMonth,
  isoDate,
  addDays,
  daysBetween,
  FREQUENCIES,
  PERIOD_MONTHS,
  DUE_MONTH_OFFSET,
  REMINDER_LADDER,
  JURISDICTION_RULES,
  MANUAL_STATUSES,
  DEFAULT_BACKFILL_PERIODS,
  DEFAULT_HORIZON_PERIODS,
};
