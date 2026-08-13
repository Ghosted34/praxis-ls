/** Dossier lifecycle transitions (MOD-29) — pure. */
"use strict";
const ALLOWED = {
  // A DRAFT is the creation wizard's working state, not a file. It leaves only
  // by being promoted (OPEN) or abandoned (CANCELLED, which is also what the
  // sweeper's delete replaces). It deliberately cannot jump to IN_PROGRESS:
  // work cannot be in progress on something that was never opened.
  DRAFT: ["OPEN", "CANCELLED"],
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
