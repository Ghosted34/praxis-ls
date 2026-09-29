/**
 * Client portal (redesign, PR 1) — HTTP handlers for the new client screens and
 * their staff half. Mounted from `portal_auth.routes.js` (basePath /portal),
 * beside the rest of the external portal.
 *
 * The client half takes its client from the GRANT (`req.portal.clientId`, set by
 * portalAuth("CLIENT")) and nothing else, for the reason the portal controller
 * states: a query parameter here would let one client read another's data.
 */
"use strict";
const service = require("./portal_client.service");
const bundles = require("./invoice_bundle.service");
const chat = require("./portal_chat.service");
const proposals = require("./portal_proposal.service");
const quoteFill = require("./portal_quote_fill.service");
const places = require("./portal_places.service");
const notify = require("./portal_notify.service");
const authService = require("../portal_auth/portal_auth.service");
const authController = require("../portal_auth/portal_auth.controller");
const admin = require("./portal_admin.service");
const portal = require("./portal.service");
const { readUpload } = require("../../shared/http/upload.middleware");
const { asyncHandler, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const clientId = (req) => {
  const id = req.portal && req.portal.clientId;
  if (!id) throw new AppError("CLIENT_REQUIRED", "A CLIENT portal grant with a client scope is required", 422);
  return id;
};
const scopeOf = (req) => (req.portal && req.portal.scope) || "ALL";
const langOf = (req) => (req.query.lang === "fr" ? "fr" : "en");
const emailOf = (req) => (req.portal && req.portal.user && req.portal.user.email) || null;
const slugOf = (req) => (req.tenant && req.tenant.slug) || "tenant";
const staff = (req) => req.user || { user_id: null };

/**
 * The client a STAFF route is about, from the path (the Client 360 it was
 * opened from). Checked as a uuid so a malformed id is a clear 422 rather
 * than a database error; MOD-29 already lets the caller see every client.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const staffClientId = (req) => {
  const id = String(req.params.clientId || "");
  if (!UUID_RE.test(id)) throw new AppError("CLIENT_REQUIRED", "Open this from a client's record", 422);
  return id;
};

/**
 * Where a person stands on signing in, for the Client 360's list. A grant is
 * tenant data and the login identity data, so they are read apart and joined
 * here by email — the key the grant was issued under.
 *
 *   ACTIVE          they have signed in (or set their password from the link)
 *   INVITED         a link is out and still valid
 *   INVITE_EXPIRED  the link ran out before they used it — resend
 *   NOT_INVITED     no login exists yet (access given without an email)
 *   DISABLED        the login itself was switched off
 */
function signInState(user, invite, now = Date.now()) {
  if (!user) return "NOT_INVITED";
  if (user.status === "DISABLED") return "DISABLED";
  if (user.last_login_at || (invite && invite.used_at)) return "ACTIVE";
  if (invite && Date.parse(invite.expires_at) > now) return "INVITED";
  return invite ? "INVITE_EXPIRED" : "NOT_INVITED";
}

async function peopleWithLogins(req, grants) {
  const { users, invites } = await req.identityDb(async (c) => {
    const found = await authService.usersByEmails(c, grants.map((g) => g.email));
    return { users: found, invites: await authService.latestInvites(c, found.map((u) => u.portal_user_id)) };
  });
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
  const inviteOf = new Map(invites.map((i) => [i.portal_user_id, i]));
  return grants.map((g) => {
    const u = byEmail.get(String(g.email).toLowerCase()) || null;
    const inv = u ? inviteOf.get(u.portal_user_id) || null : null;
    return {
      ...g,
      full_name: (u && u.full_name) || null,
      last_login_at: (u && u.last_login_at) || null,
      sign_in: signInState(u, inv),
      invited_at: (inv && inv.created_at) || null,
      invite_expires_at: (inv && !inv.used_at && inv.expires_at) || null,
    };
  });
}

/**
 * Who at the client did it. A message, a file sent for a request and a proof of
 * payment carry the person's login id or email (business data); the NAME is on
 * the login, in the identity schema, so it is read apart and joined here — the
 * way `peopleWithLogins` joins a grant to its login. A name staff corrected
 * later shows on everything that person already sent.
 *
 * `refs` are `{ id, email }`; the result looks one up, or answers null.
 */
async function portalNames(req, refs) {
  const ids = refs.map((r) => r && r.id).filter(Boolean);
  const emails = refs.map((r) => r && r.email).filter(Boolean);
  if (!ids.length && !emails.length) return () => null;
  const { byId, byEmail } = await req.identityDb((c) => authService.namesFor(c, { ids, emails }));
  return (r) =>
    (r && r.id && byId.get(r.id)) || (r && r.email && byEmail.get(String(r.email).toLowerCase())) || null;
}

/** Name the colleague who wrote each client message (`author.name`). */
async function nameAuthors(req, messages) {
  const list = (messages || []).filter((m) => m && m.direction === "CLIENT" && m.author);
  const ref = (m) => ({ id: m.author.portal_user_id, email: m.author.email });
  const lookup = await portalNames(req, list.map(ref));
  for (const m of list) m.author.name = m.author.name || lookup(ref(m));
  return messages;
}

/**
 * Send (or re-send) the set-password link. The grant is already committed by
 * the time this runs, so a failure is REPORTED, never thrown: rolling back a
 * grant because a mail server was down is how a client ends up with nobody
 * able to sign in and no row saying why. The UI offers Resend on the row.
 */
async function sendInvite(req, { email, fullName }) {
  try {
    const name = await authController.tenantName(req);
    const origin = await authController.portalLinkOrigin(req);
    const r = await req.identityDb((c) =>
      authService.inviteUser(c, { email, fullName, ip: req.ip, origin, tenantName: name }));
    return { sent: true, emailed: r.emailed === true };
  } catch (err) {
    // An older grant with no login and no name: nothing was sent, and the fix
    // is theirs to make, so say which — not "try again", which never works.
    if (err && err.code === "NAME_REQUIRED") {
      throw new AppError("NAME_REQUIRED", "Add their name before sending the invitation — open Edit.", 422);
    }
    logger.error({ err, email }, "[portal] staff invite failed — the grant stands, the row offers Resend");
    return { sent: false, emailed: false };
  }
}

/** Bytes back to the browser as a download, never rendered inline. */
function sendFile(res, { buffer, name, type = "application/octet-stream" }) {
  const safe = String(name || "document").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

/**
 * A chat photo or voice note, shown IN the conversation rather than saved.
 * Only kinds whose bytes were sniffed at upload (a JPEG/PNG/WebP, an audio
 * container) are ever marked inline, and the response still refuses to be
 * anything else: nosniff, and a CSP that forbids it running or loading
 * anything if someone opens the URL on its own. An attachment never changes
 * once sent, so the browser may keep it.
 */
function sendAttachment(res, { buffer, name, type, inline }) {
  if (!inline) return sendFile(res, { buffer, name, type });
  const safe = String(name || "attachment").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=604800, immutable");
  return res.send(buffer);
}

/* ── the chat's request shapes (14170) ─────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?thread=` — "general" or a shipment id; anything else is refused, not queried. */
function threadOf(v) {
  if (v === undefined || v === null || v === "" || v === "general") return "general";
  if (UUID.test(String(v))) return String(v);
  throw new AppError("VALIDATION_ERROR", "thread must be 'general' or a shipment id", 422);
}
/** An id from the URL, checked before it reaches a uuid column. */
function uuidOf(v, name) {
  if (UUID.test(String(v || ""))) return String(v);
  throw new AppError("VALIDATION_ERROR", `${name} must be an id`, 422);
}
/** `?before=` — an instant, for paging back through a long thread. */
function beforeOf(v) {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError("VALIDATION_ERROR", "before must be a date-time", 422);
  return d.toISOString();
}
const meOf = (req) => ({
  portal_user_id: req.portal.user.portal_user_id,
  email: req.portal.user.email,
  full_name: req.portal.user.full_name || null,
});
/** The signed-in person's name, for the team's side of what they send. */
const nameOf = (req) => (req.portal && req.portal.user && req.portal.user.full_name) || null;
/** When this person's access began — "unread" never reaches back past it. */
const sinceOf = (req) => (req.portal.grant && req.portal.grant.created_at) || null;
const chatMeta = (b) => ({ width: b.width, height: b.height, durationMs: b.duration_ms });
/** The signer, from the session — never from the body (guide §6.3). */
const signerOf = (req) => meOf(req);
const ipOf = (req) => req.ip || null;
const uaOf = (req) => String(req.get("user-agent") || "").slice(0, 300) || null;
const tenantNameOf = (req) => (req.tenant && req.tenant.name) || "";
const originOf = (req) => `${req.protocol}://${req.get("host")}`;

module.exports = {
  // ── client ──
  home: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.home(c, { clientId: clientId(req), scope: scopeOf(req), lang: langOf(req), me: meOf(req), since: sinceOf(req) })),
    });
  }),
  shipments: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.shipments(c, { clientId: clientId(req), state: req.query.state, lang: langOf(req) })) });
  }),
  shipment: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.shipment(c, { clientId: clientId(req), dossierId: req.params.id, scope: scopeOf(req), lang: langOf(req) })),
    });
  }),
  requests: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.requests(c, { clientId: clientId(req) })) });
  }),
  documentTypes: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.documentTypes(c)) });
  }),
  uploadForRequest: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.uploadForRequest(c, { clientId: clientId(req), requestId: req.params.id, file, email: emailOf(req), name: nameOf(req), slug: slugOf(req) })),
    });
  }),
  answerRequest: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.answerRequest(c, { clientId: clientId(req), requestId: req.params.id, text: req.body.text, email: emailOf(req), name: nameOf(req) })),
    });
  }),
  requestFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.requestFile(c, { clientId: clientId(req), requestId: req.params.id })));
  }),
  shareDocument: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.shareDocument(c, {
          clientId: clientId(req),
          dossierId: req.body.dossier_id || null,
          docTypeCode: req.body.doc_type_code || null,
          note: req.body.note || null,
          file,
          email: emailOf(req),
          name: nameOf(req),
          slug: slugOf(req),
        })),
    });
  }),
  billing: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.billing(c, { clientId: clientId(req) })) });
  }),
  invoice: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.invoice(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, lang: langOf(req) })) });
  }),
  invoicePdf: asyncHandler(async (req, res) => {
    const out = await req.tenantDb((c) =>
      service.invoicePdf(c, {
        clientId: clientId(req),
        invoiceId: req.params.invoiceId,
        lang: langOf(req),
        origin: `${req.protocol}://${req.get("host")}`,
        env: req.env || "live",
      }));
    sendFile(res, { ...out, type: "application/pdf" });
  }),
  submitProof: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.submitProof(c, {
          clientId: clientId(req),
          email: emailOf(req),
          name: nameOf(req),
          amount: b.amount,
          currency: b.currency || "XAF",
          method: b.method,
          provider: b.provider || null,
          paidOn: b.paid_on,
          reference: b.reference || null,
          note: b.note || null,
          dossierId: b.dossier_id || null,
          allocations: b.allocations || [],
          file,
          slug: slugOf(req),
        })),
    });
  }),
  proofFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.proofFile(c, { proofId: req.params.id, clientId: clientId(req) })));
  }),

  // ── the client's own team ──
  /**
   * Colleagues on this client account. The grants are tenant data and the
   * logins are identity data, so the two are read separately and joined here
   * by email — which is also how the grant was issued.
   */
  team: asyncHandler(async (req, res) => {
    const { grants, defaults } = await req.tenantDb(async (c) => ({
      grants: await service.team(c, { clientId: clientId(req) }),
      defaults: await admin.inviteDefaults(c),
    }));
    const users = await req.identityDb((c) => authService.usersByEmails(c, grants.map((g) => g.email)));
    const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
    const self = req.portal.grant && req.portal.grant.portal_access_id;
    res.json({
      data: {
        can_manage: req.portal.grant && req.portal.grant.is_client_admin === true,
        // The tenant's default for a new colleague (⚙ on the Clients screen),
        // so an admin's invite starts where staff invites do.
        default_scope: defaults.access_scope,
        members: grants.map((g) => {
          const u = byEmail.get(String(g.email).toLowerCase());
          return {
            ...g,
            full_name: (u && u.full_name) || null,
            last_login_at: (u && u.last_login_at) || null,
            // Never signed in = the invite is still waiting to be accepted.
            pending: !u || !u.last_login_at,
            is_you: g.portal_access_id === self,
          };
        }),
      },
    });
  }),
  teamInvite: asyncHandler(async (req, res) => {
    const cid = clientId(req);
    const grant = await req.tenantDb((c) =>
      service.addTeamMember(c, {
        clientId: cid,
        email: req.body.email,
        scope: req.body.access_scope || "ALL",
        isAdmin: req.body.is_client_admin === true,
        invitedBy: emailOf(req),
      }));
    const name = await authController.tenantName(req);
    const origin = await authController.portalLinkOrigin(req);
    const invited = await req.identityDb((c) =>
      authService.inviteUser(c, { email: req.body.email, fullName: req.body.full_name, ip: req.ip, origin, tenantName: name }));
    res.status(201).json({ data: { ...grant, emailed: invited.emailed } });
  }),
  teamUpdate: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.updateTeamMember(c, {
          clientId: clientId(req),
          grantId: req.params.id,
          scope: req.body.access_scope,
          isAdmin: req.body.is_client_admin,
          selfGrantId: req.portal.grant && req.portal.grant.portal_access_id,
        })),
    });
  }),
  teamRemove: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.removeTeamMember(c, {
          clientId: clientId(req),
          grantId: req.params.id,
          selfGrantId: req.portal.grant && req.portal.grant.portal_access_id,
        })),
    });
  }),

  // An invoice's supporting documents (14160): the list, one file, all as a ZIP.
  invoiceDocuments: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.clientView(c, { clientId: clientId(req), invoiceId: req.params.invoiceId })) });
  }),
  invoiceDocumentsZip: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) =>
      bundles.clientZip(c, {
        clientId: clientId(req),
        invoiceId: req.params.invoiceId,
        invoicePdf: () => service.invoicePdf(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, lang: langOf(req), origin: `${req.protocol}://${req.get("host")}`, env: req.env || "live" }),
      })));
  }),
  invoiceDocument: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => bundles.clientFile(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, docId: req.params.docId })));
  }),

  // The chat (14170): General and one thread per shipment.
  chatThreads: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.threads(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), since: sinceOf(req) })),
    });
  }),
  // The badge on the chat button — one count, cheap enough to poll.
  chatUnread: asyncHandler(async (req, res) => {
    res.json({
      data: { unread: await req.tenantDb((c) => chat.unread(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), since: sinceOf(req) })) },
    });
  }),
  chatMessages: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      chat.messages(c, {
        clientId: clientId(req), me: meOf(req), scope: scopeOf(req),
        thread: threadOf(req.query.thread), before: beforeOf(req.query.before), lang: langOf(req),
      }));
    // Colleagues share a thread, so each of their messages says who wrote it.
    await nameAuthors(req, data.messages);
    res.json({ data });
  }),
  chatSend: asyncHandler(async (req, res) => {
    const b = req.body;
    const sent = await req.tenantDb((c) =>
        chat.send(c, {
          clientId: clientId(req), me: meOf(req), scope: scopeOf(req),
          thread: b.thread || "general", body: b.body, milestoneId: b.milestone_instance_id || null,
          location: b.lat !== undefined ? { lat: b.lat, lng: b.lng, label: b.location_label || null } : null,
          file: req.file || null, meta: chatMeta(b), slug: slugOf(req), lang: langOf(req),
        }));
    if (sent && sent.author && !sent.author.name) sent.author.name = nameOf(req);
    res.status(201).json({ data: sent });
  }),
  chatRead: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.read(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), thread: req.body.thread || "general", at: req.body.at || null })),
    });
  }),
  chatAttachment: asyncHandler(async (req, res) => {
    sendAttachment(res, await req.tenantDb((c) =>
      chat.clientAttachment(c, {
        clientId: clientId(req), scope: scopeOf(req), attachmentId: uuidOf(req.params.attachmentId, "attachmentId"),
        size: req.query.size === "preview" ? "preview" : null,
      })));
  }),

  // Proposals: read, download, decline, accept — with an e-signature where the
  // tenant offers one (portal_proposal.service).
  proposals: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => proposals.list(c, { clientId: clientId(req) })) });
  }),
  proposal: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        proposals.get(c, { clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), lang: langOf(req) })),
    });
  }),
  proposalPdf: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => proposals.pdf(c, { clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), lang: langOf(req) })));
  }),
  proposalDecline: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        proposals.decline(c, {
          clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), me: signerOf(req),
          reasonCode: req.body.reason_code, note: req.body.note || null, lang: langOf(req),
        })),
    });
  }),
  proposalAccept: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        proposals.accept(c, { clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), me: signerOf(req), ip: ipOf(req), lang: langOf(req) })),
    });
  }),
  proposalSignStart: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        proposals.startSigning(c, {
          clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), me: signerOf(req),
          grantId: req.portal.grant && req.portal.grant.portal_access_id, lang: langOf(req), tenantName: tenantNameOf(req),
        })),
    });
  }),
  proposalSignResend: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        proposals.resendCode(c, { clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), me: signerOf(req), lang: langOf(req), tenantName: tenantNameOf(req) })),
    });
  }),
  proposalSignComplete: asyncHandler(async (req, res) => {
    const b = req.body;
    res.json({
      data: await req.tenantDb((c) =>
        proposals.completeSigning(c, {
          clientId: clientId(req), proposalId: uuidOf(req.params.id, "id"), me: signerOf(req),
          code: b.code, presetCode: b.preset_code, fullName: b.full_name || null, partyRole: b.party_role || null,
          markImageB64: b.mark_image_b64 || null, ip: ipOf(req), userAgent: uaOf(req), lang: langOf(req),
          origin: originOf(req), slug: slugOf(req),
        })),
    });
  }),
  quoteFill: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => quoteFill.fill(c, { text: req.body.text, env: req.env || "live" })) });
  }),
  /**
   * The quote sheet's place search. Two phases on purpose: the tenant
   * connection is released BEFORE the worldwide search, so a slow provider
   * waits on its own time and not on a pool slot (portal_places.service).
   */
  places: asyncHandler(async (req, res) => {
    const cid = clientId(req);
    const { q = "", kind, country, provider } = req.validatedQuery;
    const local = await req.tenantDb((c) => places.searchLocal(c, { clientId: cid, q, kinds: kind }));
    res.json({ data: await places.withProvider(local, { q, country: country || null, provider }) });
  }),

  // Notifications (14180). The switches are tenant data, keyed to this
  // person at this client; the devices are identity, so they are read and
  // written on identityDb like a staff login's (notification.controller).
  notifySettings: asyncHandler(async (req, res) => {
    const cid = clientId(req);
    const settings = await req.tenantDb((c) => notify.settings(c, { clientId: cid, email: emailOf(req), scope: scopeOf(req) }));
    const devices = await req.identityDb((c) => notify.devices(c, { portalUserId: req.portal.user.portal_user_id }));
    res.json({ data: { ...settings, ...devices } });
  }),
  notifySave: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        notify.saveSettings(c, {
          clientId: clientId(req), email: emailOf(req), scope: scopeOf(req),
          topics: req.body.topics, language: req.body.language || null,
        })),
    });
  }),
  pushSubscribe: asyncHandler(async (req, res) => {
    const cid = clientId(req);
    const out = await req.identityDb((c) =>
      notify.subscribe(c, { portalUserId: req.portal.user.portal_user_id, subscription: req.body.subscription, userAgent: uaOf(req) }));
    // The first device allowed is where the language of the emails is learnt.
    if (req.body.language) {
      await req.tenantDb((c) => notify.rememberLanguage(c, { clientId: cid, email: emailOf(req), language: req.body.language }));
    }
    res.json({ data: out });
  }),
  pushUnsubscribe: asyncHandler(async (req, res) => {
    res.json({
      data: await req.identityDb((c) => notify.unsubscribe(c, { portalUserId: req.portal.user.portal_user_id, endpoint: req.body.endpoint })),
    });
  }),
  pushTest: asyncHandler(async (req, res) => {
    const name = await authController.tenantName(req);
    res.json({
      data: await req.identityDb((c) => notify.test(c, { portalUserId: req.portal.user.portal_user_id, lang: langOf(req), tenantName: name })),
    });
  }),

  // ── staff ──
  // The Client inbox (PR 3): every client conversation, waiting first.
  staffChatInbox: asyncHandler(async (req, res) => {
    const filter = ["all", "waiting", "mine"].includes(req.query.filter) ? req.query.filter : "all";
    const data = await req.tenantDb((c) => chat.staffInbox(c, { filter, actor: staff(req) }));
    // "Paul Atiock: is the container out?" — who at the client wrote last.
    const authors = data.items.map((i) => i.last && i.last.author).filter(Boolean);
    const lookup = await portalNames(req, authors.map((a) => ({ id: a.portal_user_id, email: a.email })));
    for (const a of authors) a.name = lookup({ id: a.portal_user_id, email: a.email });
    res.json({ data });
  }),
  staffChatThreads: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => chat.staffThreads(c, { clientId: uuidOf(req.query.client_id, "client_id") })) });
  }),
  staffChatMessages: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) =>
      chat.staffMessages(c, { clientId: uuidOf(req.query.client_id, "client_id"), thread: threadOf(req.query.thread), before: beforeOf(req.query.before) }));
    await nameAuthors(req, data.messages);
    res.json({ data });
  }),
  staffChatSend: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        chat.staffSend(c, {
          clientId: b.client_id, thread: b.thread || "general", body: b.body,
          milestoneId: b.milestone_instance_id || null, file: req.file || null, meta: chatMeta(b),
          location: b.lat !== undefined ? { lat: b.lat, lng: b.lng, label: b.location_label || null } : null,
          actor: staff(req), slug: slugOf(req),
        })),
    });
  }),
  staffChatRead: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => chat.staffRead(c, { clientId: req.body.client_id, thread: req.body.thread || "general" })) });
  }),
  staffChatAttachment: asyncHandler(async (req, res) => {
    sendAttachment(res, await req.tenantDb((c) =>
      chat.staffAttachment(c, { attachmentId: uuidOf(req.params.attachmentId, "attachmentId"), size: req.query.size === "preview" ? "preview" : null })));
  }),
  staffInvoiceBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.staffView(c, { invoiceId: req.params.invoiceId })) });
  }),
  staffPublishBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.publish(c, { invoiceId: req.params.invoiceId, docIds: req.body.doc_ids, actor: staff(req) })) });
  }),
  staffWithdrawBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.withdraw(c, { invoiceId: req.params.invoiceId, actor: staff(req) })) });
  }),
  staffRequests: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) =>
      service.staffRequests(c, { clientId: req.query.client_id || null, status: req.query.status || null }));
    // Who at the client sent the file or the answer.
    const lookup = await portalNames(req, rows.map((r) => ({ email: r.answered_by_email })));
    res.json({ data: rows.map((r) => ({ ...r, answered_by_name: lookup({ email: r.answered_by_email }) })) });
  }),
  staffCreateRequest: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.createRequest(c, {
          clientId: b.client_id,
          dossierId: b.dossier_id || null,
          kind: b.kind,
          docTypeCode: b.doc_type_code || null,
          title: b.title || null,
          note: b.note || null,
          dueOn: b.due_on || null,
          actor: staff(req),
        })),
    });
  }),
  staffReviewRequest: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.reviewRequest(c, { requestId: req.params.id, decision: req.body.decision, note: req.body.note || null, actor: staff(req) })),
    });
  }),
  staffRequestFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.staffRequestFile(c, { requestId: req.params.id })));
  }),
  staffProofs: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) =>
      service.staffProofs(c, { status: req.query.status || null, clientId: req.query.client_id || null }));
    // Who at the client says they paid.
    const lookup = await portalNames(req, rows.map((p) => ({ email: p.submitted_by_email })));
    res.json({ data: rows.map((p) => ({ ...p, submitted_by_name: lookup({ email: p.submitted_by_email }) })) });
  }),
  staffConfirmProof: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.confirmProof(c, { proofId: req.params.id, treasuryAccountId: req.body.treasury_account_id || null, actor: staff(req) })),
    });
  }),
  staffRejectProof: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.rejectProof(c, { proofId: req.params.id, note: req.body.note, actor: staff(req) })) });
  }),
  staffProofFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.proofFile(c, { proofId: req.params.id })));
  }),

  // ── staff: a client's portal, from the Client 360 (MOD-29) ──
  staffPeople: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    const { grants, defaults } = await req.tenantDb(async (c) => ({
      grants: await admin.people(c, { clientId: cid }),
      defaults: await admin.inviteDefaults(c),
    }));
    res.json({ data: { members: await peopleWithLogins(req, grants), defaults } });
  }),
  staffPeopleAdd: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    const b = req.body;
    const grant = await req.tenantDb((c) =>
      admin.addPerson(c, {
        clientId: cid, email: b.email, accessScope: b.access_scope, isClientAdmin: b.is_client_admin,
        expiresAt: b.expires_at || null, actor: staff(req),
      }));
    // The login is made now even when the email waits, so the name typed here
    // is kept — otherwise "Give access" without an email would drop it.
    if (b.send_invite === false) await req.identityDb((c) => authService.ensureUser(c, { email: grant.email, fullName: b.full_name }));
    const invite = b.send_invite === false ? { sent: false, emailed: false } : await sendInvite(req, { email: grant.email, fullName: b.full_name });
    const [person] = await peopleWithLogins(req, [grant]);
    res.status(201).json({ data: { ...person, invite } });
  }),
  staffPeopleUpdate: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    const b = req.body;
    const row = await req.tenantDb((c) =>
      admin.updatePerson(c, {
        clientId: cid, grantId: req.params.id, accessScope: b.access_scope, isClientAdmin: b.is_client_admin,
        expiresAt: Object.prototype.hasOwnProperty.call(b, "expires_at") ? b.expires_at || null : undefined,
        actor: staff(req),
      }));
    // The name is the login's, not the grant's: one person, one name, however
    // many clients they sign in for. A person given access without an invite
    // has no login yet, so naming them makes one (it signs nobody in).
    if (b.full_name) {
      await req.identityDb(async (c) => {
        const { user } = await authService.ensureUser(c, { email: row.email, fullName: b.full_name });
        await authService.setFullName(c, { portalUserId: user.portal_user_id, fullName: b.full_name });
      });
    }
    const [person] = await peopleWithLogins(req, [row]);
    res.json({ data: person });
  }),
  staffPeopleResend: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    const grant = await req.tenantDb((c) => admin.personFor(c, { clientId: cid, grantId: req.params.id }));
    const invite = await sendInvite(req, { email: grant.email });
    if (!invite.sent) throw new AppError("INVITE_FAILED", "The invitation could not be sent. Try again in a moment.", 502);
    const [person] = await peopleWithLogins(req, [grant]);
    res.json({ data: { ...person, invite } });
  }),
  staffPeopleRevoke: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    res.json({ data: await req.tenantDb((c) => admin.revokePerson(c, { clientId: cid, grantId: req.params.id, actor: staff(req) })) });
  }),
  staffOnboarding: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    res.json({ data: await req.tenantDb((c) => portal.clientOnboarding(c, { clientId: cid })) });
  }),
  staffOnboardingToggle: asyncHandler(async (req, res) => {
    const cid = staffClientId(req);
    res.json({ data: await req.tenantDb((c) => portal.toggleOnboardingStep(c, { clientId: cid, stepKey: req.params.stepKey, actor: staff(req) })) });
  }),

  // ── staff: portal settings for every client (the Clients screen's ⚙) ──
  portalSettings: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb(async (c) => ({
        invite_defaults: await admin.inviteDefaults(c),
        onboarding_steps: await admin.onboardingTemplate(c),
      })),
    });
  }),
  saveInviteDefaults: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        admin.saveInviteDefaults(c, { accessScope: req.body.access_scope, firstIsAdmin: req.body.first_is_admin, actor: staff(req) })),
    });
  }),
  createOnboardingStep: asyncHandler(async (req, res) => {
    res.status(201).json({
      data: await req.tenantDb((c) =>
        admin.createOnboardingStep(c, { labelEn: req.body.label_en, labelFr: req.body.label_fr, actor: staff(req) })),
    });
  }),
  updateOnboardingStep: asyncHandler(async (req, res) => {
    const b = req.body;
    res.json({
      data: await req.tenantDb((c) =>
        admin.updateOnboardingStep(c, {
          stepKey: req.params.stepKey, labelEn: b.label_en, labelFr: b.label_fr, isActive: b.is_active, actor: staff(req),
        })),
    });
  }),
  moveOnboardingStep: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        admin.moveOnboardingStep(c, { stepKey: req.params.stepKey, direction: req.body.direction, actor: staff(req) })),
    });
  }),
};

// Exported for the unit tests: the sign-in state is the one piece of logic
// here that is not a pass-through.
module.exports.signInState = signInState;
