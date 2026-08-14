"use strict";
const service = require("./dashboard.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  kpis: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.kpis(c)) })),
  controlTower: asyncHandler(async (req, res) => {
    const q = req.query || {};
    const limit = Math.max(1, Math.min(Number(q.limit) || 50, 100));
    const allowed = new Set(["created", "updated", "arrival", "delivery"]);
    const options = {
      limit, cursor: q.cursor || null, serviceTypeId: q.service_type_id || null,
      territory: q.territory || null, mode: q.mode ? String(q.mode).toUpperCase() : null,
      dateField: allowed.has(q.date_field) ? q.date_field : "created",
      from: q.from || null, to: q.to || null, includeCompleted: q.include_completed === "true",
    };
    res.json({ data: await req.tenantDb((c) => service.controlTower(c, options)) });
  }),
};
