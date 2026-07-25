/**
 * Platform (company dashboard) HTTP controller — thin: delegate to the services.
 */
"use strict";

const tenants = require("../../services/platform/tenants.service");
const provisioning = require("../../services/platform/provisioning.service");
const platformAuthService = require("../../services/platform/auth.service");
const support = require("../../services/platform/support.service");
const users = require("../../services/platform/users.service");
const plans = require("../../services/platform/plans.service");
const roles = require("../../services/platform/roles.service");
const { CAP_CATALOGUE } = require("../../middleware/platform-auth");
const platformSettings = require("../../services/platform/settings.service");
const storage = require("../../services/storage.service");
const { asyncHandler } = require("../../utils/errors");

const actor = (req) =>
  req.platformUser ? req.platformUser.platform_user_id : null;

const login = asyncHandler(async (req, res) => {
  const result = await platformAuthService.login({
    email: req.body.email,
    password: req.body.password,
  });
  res.json({ data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await platformAuthService.refresh({
    refreshToken: req.body.refresh_token,
  });
  res.json({ data: result });
});

const listModules = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.listModules() }),
);
const listFeatures = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.listFeatures() }),
);
const listPlans = asyncHandler(async (_req, res) =>
  res.json({ data: await plans.list() }),
);

// ── Capability catalogue + RBAC roles (permission matrix) ──
const capsCatalogue = asyncHandler(async (_req, res) => res.json({ data: CAP_CATALOGUE }));
const rolesList = asyncHandler(async (_req, res) => res.json({ data: await roles.list() }));
const roleCreate = asyncHandler(async (req, res) =>
  res.status(201).json({ data: await roles.create({ code: req.body.code, name: req.body.name, capabilities: req.body.capabilities }) }),
);
const roleSetPermissions = asyncHandler(async (req, res) =>
  res.json({ data: await roles.setPermissions(req.params.id, req.body.capabilities) }),
);
const roleDelete = asyncHandler(async (req, res) =>
  res.json({ data: await roles.remove(req.params.id) }),
);

// ── Platform users ──
const usersList = asyncHandler(async (_req, res) => res.json({ data: await users.list() }));
const userCreate = asyncHandler(async (req, res) =>
  res.status(201).json({ data: await users.create({ email: req.body.email, fullName: req.body.full_name, password: req.body.password, role: req.body.role }) }),
);
const userUpdate = asyncHandler(async (req, res) =>
  res.json({ data: await users.update(req.params.id, { fullName: req.body.full_name, role: req.body.role, isActive: req.body.is_active }) }),
);
const userSetPassword = asyncHandler(async (req, res) =>
  res.json({ data: await users.setPassword(req.params.id, req.body.password) }),
);
const userDelete = asyncHandler(async (req, res) =>
  res.json({ data: await users.remove(req.params.id, actor(req)) }),
);

// ── Plans (write + feature matrix) ──
const planCreate = asyncHandler(async (req, res) =>
  res.status(201).json({ data: await plans.create({ code: req.body.code, name: req.body.name, priceSetupXaf: req.body.price_setup_xaf, priceYearlyXaf: req.body.price_yearly_xaf }, actor(req)) }),
);
const planUpdate = asyncHandler(async (req, res) =>
  res.json({ data: await plans.update(req.params.id, { name: req.body.name, priceSetupXaf: req.body.price_setup_xaf, priceYearlyXaf: req.body.price_yearly_xaf }, actor(req)) }),
);
const planFeatures = asyncHandler(async (req, res) => res.json({ data: await plans.features(req.params.id) }));
const planSetFeatures = asyncHandler(async (req, res) =>
  res.json({ data: await plans.setFeatures(req.params.id, req.body.features, actor(req)) }),
);
const planDelete = asyncHandler(async (req, res) =>
  res.json({ data: await plans.remove(req.params.id, req.body.replacement, actor(req)) }),
);

const list = asyncHandler(async (_req, res) =>
  res.json({ data: await tenants.list() }),
);
const audit = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.recentAudit({ slug: req.query.tenant, limit: req.query.limit }),
  }),
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

const createAdmin = asyncHandler(async (req, res) =>
  res.status(201).json({
    data: await provisioning.createAdmin({
      slug: req.params.slug,
      email: req.body.email,
      name: req.body.name,
      password: req.body.password,
      role: req.body.role,
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
const setPlan = asyncHandler(async (req, res) =>
  res.json({
    data: await tenants.setPlan(req.params.slug, req.body.plan, actor(req)),
  }),
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

const supportList = asyncHandler(async (req, res) =>
  res.json({
    data: await support.list({
      status: req.query.status,
      kind: req.query.kind,
      tenant: req.query.tenant,
      limit: req.query.limit,
    }),
  }),
);
const supportGet = asyncHandler(async (req, res) =>
  res.json({ data: await support.get(req.params.id) }),
);
const supportSetStatus = asyncHandler(async (req, res) =>
  res.json({ data: await support.setStatus(req.params.id, req.body.status, actor(req)) }),
);

// ── Deploy-wide integration settings (S3 / Geoapify / VAPID) ──
const settingsList = asyncHandler(async (_req, res) =>
  res.json({ data: await platformSettings.list() }),
);
const settingGet = asyncHandler(async (req, res) =>
  res.json({ data: await platformSettings.get(req.params.section, req.params.key) }),
);
const settingPut = asyncHandler(async (req, res) => {
  const data = await platformSettings.put({
    section: req.params.section,
    key: req.params.key,
    value: req.body.value || {},
    secret: req.body.secret,
    actor: actor(req),
  });
  // Storage creds are cached in the storage singleton — drop it so the new
  // values take effect without a restart.
  if (req.params.section === "storage" && typeof storage.resetCache === "function") storage.resetCache();
  res.json({ data });
});
const settingTest = asyncHandler(async (req, res) =>
  res.json({ data: await platformSettings.test(req.params.section, req.params.key) }),
);
const vapidGenerate = asyncHandler(async (req, res) =>
  res.json({ data: await platformSettings.generateVapid({ subject: req.body.subject, actor: actor(req) }) }),
);

module.exports = {
  login,
  refresh,
  listModules,
  listFeatures,
  listPlans,
  list,
  audit,
  get,
  provision,
  createAdmin,
  suspend,
  resume,
  goLive,
  setPlan,
  setCapacity,
  setSandbox,
  wipeSandbox,
  migrate,
  features,
  setFeature,
  clearFeature,
  supportList,
  supportGet,
  supportSetStatus,
  capsCatalogue,
  rolesList,
  roleCreate,
  roleSetPermissions,
  roleDelete,
  usersList,
  userCreate,
  userUpdate,
  userSetPassword,
  userDelete,
  planCreate,
  planUpdate,
  planFeatures,
  planSetFeatures,
  planDelete,
  settingsList,
  settingGet,
  settingPut,
  settingTest,
  vapidGenerate,
};
