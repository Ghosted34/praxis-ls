/** Dossier lifecycle transitions (MOD-29) — pure. */
"use strict";
const ALLOWED = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
function canTransition(from, to) {
  return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}
const isTerminal = (s) => s === "COMPLETED" || s === "CANCELLED";
module.exports = { canTransition, isTerminal, ALLOWED };
