/** Lead (MOD-20) — pure lifecycle. NEW→CONTACTED→QUALIFIED→CONVERTED/LOST. */
"use strict";
const { AppError } = require("../../../utils/errors");
const NEXT = { NEW: ["CONTACTED", "LOST"], CONTACTED: ["QUALIFIED", "LOST"], QUALIFIED: ["CONVERTED", "LOST"], CONVERTED: [], LOST: [] };
function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move lead ${from} -> ${to}`, 422);
  return true;
}
module.exports = { NEXT, assertTransition };
