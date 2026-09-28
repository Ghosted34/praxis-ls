// ai:none — portal sign-in for clients, investors and auditors. Issuing and checking credentials is the boundary the AI runs INSIDE, never a tool it may call.
"use strict";
const service = require("./portal_auth.service");
const passkeys = require("./portal_passkey.service");
const portal = require("../portal/portal.service");
const portalClient = require("../portal/portal_client.service");
const branding = require("../branding/branding.service");
const registry = require("../../services/tenant/registry.service");
const { logger } = require("../../config/logger");
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

/**
 * The origin a portal link in an email should point at: the tenant's own
 * public-surface host when it has one, otherwise the host the request came in on.
 *
 * The request host is usually the WORKSPACE host (staff send invites from the
 * ERP), and that origin belongs to the installed staff PWA — Android and desktop
 * Chromium open any link on it in the app window, so a client's set-password
 * link opened in the staff app. A public-surface host is a different origin
 * that serves `/portal/*` too, so the link opens in a browser everywhere. See
 * registry.publicSurfaceOrigin. Best-effort: a failed lookup must not stop the
 * email, it only means the link keeps the request's host.
 */
async function portalLinkOrigin(req) {
  const tenantId = req.tenant && req.tenant.tenant_id;
  try {
    const pub = await registry.publicSurfaceOrigin(tenantId);
    if (pub) return pub;
  } catch (err) {
    // degraded: fall back to the request host; the link still works, it just
    // may open in the installed staff app.
    logger.warn({ err, tenantId }, "public host lookup failed — portal link uses the request host");
  }
  return originOf(req);
}

/** Who is asking, for the session row and the "signed-in devices" list. */
const deviceOf = (req) => ({ userAgent: req.headers["user-agent"] || null, ip: req.ip || null });

module.exports = {
  // ── Public login ──
  login: asyncHandler(async (req, res) => {
    const result = await req.identityDb((c) =>
      service.login(c, { email: req.body.email, password: req.body.password, trust: req.body.trust_device === true, ...deviceOf(req) }));
    res.json({ data: result });
  }),

  // ── Trusted-device sessions + emailed codes (14150) ──
  refresh: asyncHandler(async (req, res) => {
    res.json({ data: await req.identityDb((c) => service.refresh(c, { refreshToken: req.body.refresh_token })) });
  }),
  logout: asyncHandler(async (req, res) => {
    res.json({ data: await req.identityDb((c) => service.logout(c, { refreshToken: req.body.refresh_token })) });
  }),
  requestCode: asyncHandler(async (req, res) => {
    const name = await tenantName(req);
    res.json({ data: await req.identityDb((c) => service.requestCode(c, { email: req.body.email, ip: req.ip, tenantName: name })) });
  }),
  verifyCode: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        service.verifyCode(c, { email: req.body.email, code: req.body.code, trust: req.body.trust_device === true, ...deviceOf(req) })),
    });
  }),
  sessions: asyncHandler(async (req, res) => {
    const rows = await req.identityDb((c) => service.listSessions(c, req.portal.user.portal_user_id));
    const current = req.portal.token && req.portal.token.sid;
    res.json({ data: rows.map((r) => ({ ...r, is_current: r.portal_session_id === current })) });
  }),
  revokeSession: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        service.revokeSession(c, { portalUserId: req.portal.user.portal_user_id, sessionId: req.params.id })),
    });
  }),

  // ── Face ID / fingerprint (14150) ──
  passkeyRegisterOptions: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        passkeys.registrationOptions(c, { user: req.portal.user, tokenIat: req.portal.token && req.portal.token.iat, req })),
    });
  }),
  passkeyRegisterVerify: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        passkeys.verifyRegistration(c, {
          user: req.portal.user,
          attestation: req.body.attestation,
          challengeToken: req.body.challengeToken,
          label: req.body.label || null,
          req,
        })),
    });
  }),
  passkeyLoginOptions: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        passkeys.authenticationOptions(c, { email: req.body.email || null, credentialIds: req.body.credential_ids || [], req })),
    });
  }),
  passkeyLoginVerify: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        passkeys.verifyAuthentication(c, {
          assertion: req.body.assertion,
          challengeToken: req.body.challengeToken,
          trust: req.body.trust_device === true,
          req,
          ip: req.ip,
        })),
    });
  }),
  passkeys: asyncHandler(async (req, res) => {
    res.json({ data: await req.identityDb((c) => passkeys.listPasskeys(c, req.portal.user.portal_user_id)) });
  }),
  deletePasskey: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) =>
        passkeys.deletePasskey(c, { portalUserId: req.portal.user.portal_user_id, credentialId: req.params.id })),
    });
  }),

  // ── Portal-user self ──
  /**
   * Who is signed in and what they may open — plus, for a client, the company
   * name and their team role. The portal's "Welcome back, Marie · ACME SARL"
   * and the tabs a finance-only colleague sees are both read from here.
   */
  me: asyncHandler(async (req, res) => {
    const email = req.portal.user.email;
    const grants = {};
    for (const p of PORTALS) {
      const g = await req.tenantDb((c) => portal.checkAccess(c, { email, portal: p }));
      grants[p] = {
        allowed: g.allowed,
        client_id: g.grant ? g.grant.client_id : null,
        expires_at: g.grant ? g.grant.expires_at : null,
        access_scope: g.grant ? g.grant.access_scope || "ALL" : null,
        is_client_admin: g.grant ? g.grant.is_client_admin === true : false,
      };
    }
    const clientId = grants.CLIENT.allowed ? grants.CLIENT.client_id : null;
    const company = clientId ? await req.tenantDb((c) => portalClient.clientIdentity(c, { clientId })) : null;
    res.json({ data: { portal_user: req.portal.user, grants, company } });
  }),

  // ── Scoped data views (grant enforced by portalAuth) ──
  client: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientView(c, { clientId: req.portal.clientId })) })),
  // A client opening one of their own files: the visible stages, the committed
  // dates, and the assumptions those dates depend on. `clientId` comes from the
  // PORTAL SESSION, never the query string — a client must not be able to ask
  // for another client's file by changing a parameter.
  clientChain: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientChain(c, { clientId: req.portal.clientId, dossierId: req.params.dossierId })) })),
  // Meeting 5 — what an invoice was for, grouped as the printed invoice groups it.
  clientInvoice: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientInvoice(c, { clientId: req.portal.clientId, invoiceId: req.params.invoiceId, lang: req.query.lang })) })),
  tickets: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientTickets(c, { clientId: req.portal.clientId })) })),
  ticket: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => portal.clientTicketDetail(c, { clientId: req.portal.clientId, ticketId: req.params.id })) })),
  raiseTicket: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => portal.clientRaiseTicket(c, { clientId: req.portal.clientId, dossierId: req.body.dossier_id, milestoneInstanceId: req.body.milestone_instance_id, subject: req.body.subject, body: req.body.body, raisedBy: req.portal.user.email || null })) })),
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
    const origin = await portalLinkOrigin(req);
    const data = await req.identityDb((c) =>
      service.inviteUser(c, {
        email: req.body.email,
        fullName: req.body.full_name,
        ip: req.ip,
        origin,
        tenantName: name,
      }),
    );
    res.status(data.created ? 201 : 200).json({ data });
  }),

  /** Public. Always 200 — never reveals whether an email is registered. */
  forgot: asyncHandler(async (req, res) => {
    const name = await tenantName(req);
    const origin = await portalLinkOrigin(req);
    const data = await req.identityDb((c) =>
      service.requestReset(c, { email: req.body.email, ip: req.ip, origin, tenantName: name }),
    );
    res.json({ data });
  }),

  /** Public. Consumes the one-time token and signs the user straight in. */
  accept: asyncHandler(async (req, res) => {
    const data = await req.identityDb((c) =>
      service.acceptInvite(c, { token: req.body.token, password: req.body.password, trust: req.body.trust_device === true, ...deviceOf(req) }));
    res.json({ data });
  }),

  // Exported for the client-team invite (portal.controller), which sends the same
  // set-password mail from the portal rather than from the ERP.
  tenantName,
  portalLinkOrigin,
};
