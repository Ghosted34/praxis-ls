"use strict";
const { AppError } = require("../../../utils/errors");
const NEXT = { DRAFT: ["ACTIVE"], ACTIVE: ["PAUSED", "ENDED"], PAUSED: ["ACTIVE", "ENDED"], ENDED: [] };
function assertTransition(from, to) { if (!NEXT[from] || !NEXT[from].includes(to)) throw new AppError("BAD_STATE", `Cannot move campaign ${from} -> ${to}`, 422); return true; }
module.exports = { NEXT, assertTransition };
