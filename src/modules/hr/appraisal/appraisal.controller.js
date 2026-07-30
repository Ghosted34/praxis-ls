"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./appraisal.service");

const base = makeController(service, "Appraisal");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  // Self-service: the caller's own appraisals (My HR). Guarded so a user with no
  // linked employee never falls through to an unfiltered list.
  mine: asyncHandler(async (req, res) => {
    const employeeId = req.user.employee_id;
    if (!employeeId) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: employeeId })) });
  }),
  // Recommend a performance reward (→ a PENDING payroll earning).
  reward: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.recommendReward(c, { id: req.params.id, amount: req.body.amount, label: req.body.label || null, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
};
