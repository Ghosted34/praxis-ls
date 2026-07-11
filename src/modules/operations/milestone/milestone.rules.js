/** Milestone engine rules (MOD-31) — pure. */
"use strict";

/** due date = base date + offset days (ISO YYYY-MM-DD). */
function computeDue(baseISO, offsetDays = 0) {
  const d = new Date(String(baseISO).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(offsetDays || 0));
  return d.toISOString().slice(0, 10);
}

const ALLOWED = {
  PENDING: ["IN_PROGRESS", "BLOCKED"],
  IN_PROGRESS: ["DONE", "BLOCKED"],
  BLOCKED: ["IN_PROGRESS", "PENDING"],
  DONE: [],
};
const canAdvance = (from, to) => Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);

module.exports = { computeDue, canAdvance, ALLOWED };
