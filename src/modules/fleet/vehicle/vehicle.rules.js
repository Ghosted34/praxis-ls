/** Vehicle pure rules (MOD-39) — status lifecycle. */
"use strict";

// ACTIVE ⇄ INACTIVE (temporary off-road), either → DISPOSED (terminal, once the
// asset leaves the fleet — KB §11 disposal).
const TRANSITIONS = {
  ACTIVE: ["INACTIVE", "DISPOSED"],
  INACTIVE: ["ACTIVE", "DISPOSED"],
  DISPOSED: [],
};

function canTransition(from, to) {
  if (from === to) return true;
  return (TRANSITIONS[from] || []).includes(to);
}

module.exports = { TRANSITIONS, canTransition };
