"use strict";
const service = require("./treasury_category.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

// Explicit allow-list for the update patch. `req.body` never reaches the
// service verbatim — the validator already strips unknown keys, but a bare
// spread onto a service call is what CodeQL's mass-assignment rules flag,
// and the pattern would let an attacker mint an `is_system: true` category
// (or flip an existing category to non-deletable) if the schema ever grew
// in a way that trusted the incoming shape.
const UPDATE_FIELDS = [
  "label", "code", "coa_parent_code",
  "requires_custodian", "is_bank_identity", "is_momo_identity",
];
function pick(src, keys) {
  const out = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Treasury category not found", 404);
    res.json({ data: r });
  }),
  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      code: b.code, label: b.label, legacyKind: b.legacy_kind, coaParentCode: b.coa_parent_code,
      requiresCustodian: b.requires_custodian, isBankIdentity: b.is_bank_identity, isMomoIdentity: b.is_momo_identity,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),
  update: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.update(c, {
      id: req.params.id, patch: pick(req.body, UPDATE_FIELDS), actor: actor(req),
    })),
  })),
  setActive: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, active: req.body.active === true, actor: actor(req) })),
  })),
  remove: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })),
  })),
};
