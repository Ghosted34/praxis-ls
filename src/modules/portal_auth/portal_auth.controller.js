"use strict";
const service = require("./portal_auth.service");
const portal = require("../portal/portal.service");
const { asyncHandler } = require("../../utils/errors");

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"];

module.exports = {
  // ── Public login ──
  login: asyncHandler(async (req, res) => {
    const result = await req.identityDb((c) => service.login(c, { email: req.body.email, password: req.body.password }));
    res.json({ data: result });
  }),

  // ── Portal-user self ──
  me: asyncHandler(async (req, res) => {
    const email = req.portal.user.email;
    const grants = {};
    for (const p of PORTALS) {
      // eslint-disable-next-line no-await-in-loop
      const g = await req.tenantDb((c) => portal.checkAccess(c, { email, portal: p }));
      grants[p] = { allowed: g.allowed, client_id: g.grant ? g.grant.client_id : null, expires_at: g.grant ? g.grant.expires_at : null };
    }
    res.json({ data: { portal_user: req.portal.user, grants } });
  }),

  // ── Scoped data views (grant enforced by portalAuth) ──
  client: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientView(c, { clientId: req.portal.clientId })) })),
  investor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.investorView(c, { params: req.query })) })),
  auditor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.auditorView(c, { params: req.query })) })),

  // ── Staff management (IAM-gated) ──
  listUsers: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listUsers(c)) })),
  createUser: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({ data: await req.identityDb((c) => service.createUser(c, { email: b.email, password: b.password, fullName: b.full_name })) });
  }),
  setPassword: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setPassword(c, { id: req.params.id, password: req.body.password })) })),
  setStatus: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status })) })),
};
