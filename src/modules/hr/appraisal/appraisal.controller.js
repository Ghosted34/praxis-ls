"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler } = require("../../../utils/errors");
const service = require("./appraisal.service");

const base = makeController(service, "Appraisal");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  // Recommend a performance reward (→ a PENDING payroll earning).
  reward: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.recommendReward(c, { id: req.params.id, amount: req.body.amount, label: req.body.label || null, actor: actor(req) }));
    res.status(201).json({ data: row });
  }),
};
