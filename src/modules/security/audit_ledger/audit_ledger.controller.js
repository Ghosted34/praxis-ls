"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./audit_ledger.service");

const crud = makeController(service, "Audit entry");

const listSoftDeletes = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.listSoftDeletes(client, req.query)) });
});

const requestRestore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.requestRestore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

const restore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.restore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

// Access reviews (4.1)
const listReviews = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listReviews(c, req.query)) }));
const createReview = asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createReview(c, { name: req.body.name, actor: req.user })) }));
const getReview = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getReview(c, req.params.id)) }));
const completeReview = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.completeReview(c, { id: req.params.id, actor: req.user })) }));
const decideEntry = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.decideEntry(c, { reviewId: req.params.id, entryId: req.params.entryId, decision: req.body.decision, note: req.body.note, actor: req.user })) }));

// Security-events read (4.2)
const listSecurityEvents = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSecurityEvents(c, req.query)) }));

module.exports = {
  ...crud, listSoftDeletes, requestRestore, restore,
  listReviews, createReview, getReview, completeReview, decideEntry,
  listSecurityEvents,
};
