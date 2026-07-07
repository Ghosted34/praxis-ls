/**
 * Platform (company dashboard) HTTP controller — thin: delegate to the services.
 */
"use strict";

const tenants = require("../../services/platform/tenants.service");
const provisioning = require("../../services/platform/provisioning.service");
const { asyncHandler } = require("../../utils/errors");

const actor = (req) =>
  req.platformUser ? req.platformUser.platform_user_id : null;

const listModules = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.listModules() }),
);
const listFeatures = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.listFeatures() }),
);
const listPlans = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.listPlans() }),
);

const list = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.list() }),
);
const get = asyncHandler(async (req, res) =>
  res.json({ data: await tenants.get(req.params.slug) }),
);
const provision = asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await provisioning.provisionTenant({
      ...req.body,
      actorId: actor(req),
    }),
  }),
);

const suspend = asyncHandler(async (req, res) =>
  res.json({ data: await tenants.suspend(req.params.slug, actor(req)) }),
);
const resume = asyncHandler(async (req, res) =>
  res.json({ data: await tenants.resume(req.params.slug, actor(req)) }),
);
const goLive = asyncHandler(async (req, res) =>
  res.json({ data: await tenants.goLive(req.params.slug, actor(req)) }),
);
const setCapacity = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.setCapacity(req.params.slug, req.body.tier, actor(req)),
  }),
);
const setSandbox = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.setSandboxInterval(
      req.params.slug,
      req.body.days,
      actor(req),
    ),
  }),
);

const wipeSandbox = asyncHandler(async (req, res) =>
  res.json({ data: await provisioning.wipeSandbox({ slug: req.params.slug }) }),
);
const migrate = asyncHandler(async (req, res) =>
  res.json({ data: await provisioning.migrateTenant(req.params.slug) }),
);

const features = asyncHandler(async (req, res) =>
  res.json({ data: await tenants.resolvedFeatures(req.params.slug) }),
);
const setFeature = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.setFeature(
      req.params.slug,
      req.params.featureKey,
      req.body.state,
      actor(req),
    ),
  }),
);
const clearFeature = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.clearFeatureOverride(
      req.params.slug,
      req.params.featureKey,
      actor(req),
    ),
  }),
);

module.exports = {
  listModules,
  listFeatures,
  listPlans,
  list,
  get,
  provision,
  suspend,
  resume,
  goLive,
  setCapacity,
  setSandbox,
  wipeSandbox,
  migrate,
  features,
  setFeature,
  clearFeature,
};
