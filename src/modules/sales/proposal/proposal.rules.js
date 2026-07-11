/** Proposal (MOD-23) — pure lifecycle + totals. DRAFT→IN_REVIEW→SENT→ACCEPTED/REJECTED. */
"use strict";
const { AppError } = require("../../../utils/errors");
const NEXT = { DRAFT: ["IN_REVIEW"], IN_REVIEW: ["SENT", "DRAFT"], SENT: ["ACCEPTED", "REJECTED"], ACCEPTED: [], REJECTED: [] };
function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move proposal ${from} -> ${to}`, 422);
  return true;
}
const round2 = (n) => Math.round(n * 100) / 100;
function totalHt(lines) {
  return round2((lines || []).reduce((s, l) => s + Number(l.qty || 1) * Number(l.unit_price || 0), 0));
}
module.exports = { NEXT, assertTransition, totalHt };
