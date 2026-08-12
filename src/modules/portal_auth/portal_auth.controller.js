"use strict";
const service = require("./portal_auth.service");
const portal = require("../portal/portal.service");
const branding = require("../branding/branding.service");
const { asyncHandler } = require("../../utils/errors");

const PORTALS = ["CLIENT", "INVESTOR", "AUDITOR"];

/**
 * The tenant's own name, for invite emails.
 *
 * An external contact has no idea what "Praxis LS" is — the mail has to say who
 * is giving them access, or it reads like phishing and gets deleted. Branding is
 * live-based (session 17), so this is the same name they see on the portal.
 * Best-effort: a missing display name must not stop an invite going out.
 */
async function tenantName(req) {
  try {
    const b = await req.identityDb((c) => branding.getBranding(c));
    return (b && b.name) || (req.tenant && req.tenant.slug) || "your logistics provider";
  } catch {
    return (req.tenant && req.tenant.slug) || "your logistics provider";
  }
}

/** Absolute origin of the request, so the emailed link points at the right host. */
const originOf = (req) => `${req.protocol}://${req.get("host")}`;

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
       
      const g = await req.tenantDb((c) => portal.checkAccess(c, { email, portal: p }));
      grants[p] = { allowed: g.allowed, client_id: g.grant ? g.grant.client_id : null, expires_at: g.grant ? g.grant.expires_at : null };
    }
    res.json({ data: { portal_user: req.portal.user, grants } });
  }),

  // ── Scoped data views (grant enforced by portalAuth) ──
  client: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientView(c, { clientId: req.portal.clientId })) })),
  // A client opening one of their own files: the visible stages, the committed
  // dates, and the assumptions those dates depend on. `clientId` comes from the
  // PORTAL SESSION, never the query string — a client must not be able to ask
  // for another client's file by changing a parameter.
  clientChain: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientChain(c, { clientId: req.portal.clientId, dossierId: req.params.dossierId })) })),
  tickets: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientTickets(c, { clientId: req.portal.clientId })) })),
  ticket: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientTicketDetail(c, { clientId: req.portal.clientId, ticketId: req.params.id })) })),
  raiseTicket: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => portal.clientRaiseTicket(c, { clientId: req.portal.clientId, dossierId: req.body.dossier_id, milestoneInstanceId: req.body.milestone_instance_id, subject: req.body.subject, body: req.body.body, raisedBy: req.portal.email || null })) })),
  replyTicket: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => portal.clientReplyTicket(c, { clientId: req.portal.clientId, ticketId: req.params.id, body: req.body.body })) })),
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

  // ── Invitations + recovery (0482) ──
  /**
   * Create-or-find the login for an email and send the set-password link. This is
   * the step that was missing: `portal_access` grants by email, and until now
   * nothing ever created the account that email would sign in with.
   */
  invite: asyncHandler(async (req, res) => {
    const name = await tenantName(req);
    const data = await req.identityDb((c) =>
      service.inviteUser(c, {
        email: req.body.email,
        fullName: req.body.full_name,
        ip: req.ip,
        origin: originOf(req),
        tenantName: name,
      }),
    );
    res.status(data.created ? 201 : 200).json({ data });
  }),

  /** Public. Always 200 — never reveals whether an email is registered. */
  forgot: asyncHandler(async (req, res) => {
    const name = await tenantName(req);
    const data = await req.identityDb((c) =>
      service.requestReset(c, { email: req.body.email, ip: req.ip, origin: originOf(req), tenantName: name }),
    );
    res.json({ data });
  }),

  /** Public. Consumes the one-time token and signs the user straight in. */
  accept: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) => service.acceptInvite(c, { token: req.body.token, password: req.body.password }));
    res.json({ data });
  }),
};
