/**
 * Onboarding (MOD-16 / 0703) — dates, ownership and completion, pure.
 *
 * ── THE ONE THAT MATTERS: A CHECKLIST CANNOT BE COMPLETED WHILE A MANDATORY
 *    ITEM IS OUTSTANDING ────────────────────────────────────────────────────
 *
 * `completionBlockers` is the reason this file exists rather than a couple of
 * helpers inline in the service. The items marked mandatory are the statutory
 * ones — the CNPS registration, the signed contract, the health-and-safety
 * briefing — and they are precisely the ones a busy first week loses. A
 * "Complete" button that closes a checklist with those outstanding does not
 * record that onboarding finished; it records that somebody wanted the row to
 * go away.
 *
 * ── DATES ARE OFFSETS, ANSWERED IN THE CALENDAR ────────────────────────────
 *
 * A template says "day -3", not "12 March", which is what lets one template
 * serve every hire. Negative offsets are meant and not a mistake: a contract
 * signed and a laptop ordered before somebody walks in is most of what good
 * onboarding is, and a schema that cannot say so pushes both to day 1.
 *
 * All arithmetic is UTC calendar-day arithmetic on `YYYY-MM-DD`, so a due date
 * does not shift because the container is on UTC and the office is not — the
 * same class of bug 0697 found in the attendance clock.
 */
"use strict";

const isDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const nil = (v) => v === null || v === undefined;
const toDate = (v) => (nil(v) || v === "" ? null : isDate(v) ? v : isDate(new Date(v)) ? new Date(v) : null);
const ymd = (v) => (toDate(v) ? toDate(v).toISOString().slice(0, 10) : null);

/**
 * The date an item is due, given the hire's start date and the template's
 * offset. Null when there is no start date — an offset from nothing is nothing,
 * and inventing today as the base would quietly date the whole checklist to
 * whenever somebody happened to press the button.
 */
function dueDateFor(startsOn, dueDays) {
  const base = ymd(startsOn);
  if (!base) return null;
  const n = Number(dueDays);
  if (!Number.isFinite(n)) return base;
  const d = new Date(Date.parse(base + "T00:00:00Z"));
  d.setUTCDate(d.getUTCDate() + Math.trunc(n));
  return d.toISOString().slice(0, 10);
}

/** Whole days between two dates, computed on the DATES so the hour a report
 *  runs at cannot change the answer. Negative = overdue. */
function daysUntil(due, today = new Date()) {
  const a = ymd(due);
  const b = ymd(today);
  if (!a || !b) return null;
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

/**
 * One item's state. Four values, because they call for four different actions
 * and a boolean `is_late` collapses the two that matter most:
 *
 *   DONE      — nothing to do.
 *   OVERDUE   — past its date and not done. Chase it.
 *   DUE_SOON  — inside the window. This is the only state where doing something
 *               now still prevents lateness, which is why it is not folded into
 *               "not yet due".
 *   PENDING   — has a date, comfortably ahead.
 *   UNDATED   — no date at all. Deliberately its own state and NOT treated as
 *               "not due": an item nobody dated will never appear in a chase
 *               list, so it has to be visible as undated rather than silently
 *               filed under fine.
 */
function itemState(item = {}, { today = new Date(), soonDays = 3 } = {}) {
  if (item.is_done) return { state: "DONE", days_remaining: null };
  const days = daysUntil(item.due_on, today);
  if (days === null) return { state: "UNDATED", days_remaining: null };
  if (days < 0) return { state: "OVERDUE", days_remaining: days };
  if (days <= Math.max(0, Number(soonDays) || 0)) return { state: "DUE_SOON", days_remaining: days };
  return { state: "PENDING", days_remaining: days };
}

/**
 * Checklist progress. `percent` is over ALL items, not over dated ones — a
 * checklist that is 3 of 12 done is 25% however many of the nine have dates,
 * and normalising over a subset would make the number rise when somebody
 * deletes a date.
 */
function progress(items = [], opts = {}) {
  const total = items.length;
  const done = items.filter((i) => i.is_done).length;
  const states = items.map((i) => itemState(i, opts).state);
  return {
    total,
    done,
    outstanding: total - done,
    overdue: states.filter((s) => s === "OVERDUE").length,
    due_soon: states.filter((s) => s === "DUE_SOON").length,
    undated: states.filter((s) => s === "UNDATED").length,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/**
 * What stops this checklist being marked complete. Returns the outstanding
 * MANDATORY items — an empty array means it may be completed.
 *
 * Returns the items themselves rather than a count or a boolean, because the
 * message a person needs is "the CNPS registration is still open", not "3 items
 * remain". A refusal that does not name what to do next gets worked around.
 */
function completionBlockers(items = []) {
  return items.filter((i) => i.is_mandatory && !i.is_done);
}

/**
 * Which template applies to a hire.
 *
 * MORE SPECIFIC WINS. A template naming both a department and a job title beats
 * one naming only the department, which beats the catch-all — otherwise the
 * generic "every new starter" list would shadow the one somebody wrote
 * specifically for warehouse operatives, and the specific list is the whole
 * reason they wrote it.
 *
 * Ties break on `priority`, then on name, so the answer is stable. Without the
 * final tie-break the winner is whatever order the planner returned, which
 * changes between runs and makes an inexplicable difference between two hires.
 */
function specificity(t = {}) {
  return (t.department ? 1 : 0) + (t.job_title ? 1 : 0);
}

function templateApplies(template = {}, employee = {}) {
  if (template.is_active === false) return false;
  const norm = (v) => String(nil(v) ? "" : v).trim().toLowerCase();
  if (template.department && norm(template.department) !== norm(employee.department)) return false;
  if (template.job_title && norm(template.job_title) !== norm(employee.job_title)) return false;
  return true;
}

function pickTemplate(templates = [], employee = {}) {
  const matches = templates.filter((t) => templateApplies(t, employee));
  if (!matches.length) return null;
  return matches.sort((a, b) =>
    specificity(b) - specificity(a)
    || (Number(b.priority) || 0) - (Number(a.priority) || 0)
    || String(a.name || "").localeCompare(String(b.name || "")),
  )[0];
}

/**
 * Turn a template's items into the rows a checklist is raised with.
 *
 * The template's text is COPIED, not referenced. Editing a template afterwards
 * must not rewrite the checklist of somebody who started three weeks ago —
 * their list is a record of what they were actually asked to do, and a live
 * reference would silently rewrite history every time HR tidied the template.
 * The `sop_document_id` stays a reference, because that one is meant to track:
 * an item should point at the current procedure, not a snapshot of last year's.
 */
function itemsFromTemplate(templateItems = [], { startsOn = null } = {}) {
  return [...templateItems]
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((t, idx) => ({
      label: t.label,
      description: t.description || null,
      due_on: dueDateFor(startsOn, t.due_days),
      owner_role: t.owner_role || null,
      sop_document_id: t.sop_document_id || null,
      is_mandatory: t.is_mandatory === true,
      // Renumbered densely rather than carrying the template's numbers, so a
      // template edited to 10/20/25/30 does not leave gaps that later reorder
      // arithmetic has to work around.
      sort_order: (idx + 1) * 10,
    }));
}

/**
 * What a candidate carries from the bench onto a live vacancy.
 *
 * Everything that makes going back to them worthwhile — the CV, the skills, the
 * assessment they were given — and nothing that would be a lie on the new row.
 * Three fields are deliberately NOT carried:
 *
 *   status          they are APPLIED on this vacancy, whatever they were on the
 *                   last one.
 *   ai_score et al  a score is against a JOB DESCRIPTION. Carrying last year's
 *                   Customs Officer score onto a Finance Manager vacancy would
 *                   put a number in the shortlist column that means nothing,
 *                   and it would sort. The new row is unscored until somebody
 *                   scores it against this role.
 *   rating          an interviewer's stars, for a different conversation.
 */
function carryForward(source = {}) {
  const out = {
    full_name: source.full_name,
    email: source.email || null,
    phone: source.phone || null,
    address: source.address || null,
    cv_vault_id: source.cv_vault_id || null,
    skills: Array.isArray(source.skills) ? source.skills : undefined,
    experience_years: nil(source.experience_years) ? null : source.experience_years,
    expected_salary: nil(source.expected_salary) ? null : source.expected_salary,
    portfolio_url: source.portfolio_url || null,
  };
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

module.exports = {
  dueDateFor, daysUntil, itemState, progress, completionBlockers,
  templateApplies, pickTemplate, specificity, itemsFromTemplate, carryForward,
};
