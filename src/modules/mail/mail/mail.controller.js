"use strict";
const service = require("./mail.service");
const mailbox = require("./mailbox.service");
const access = require("./access");
const sendPoints = require("./sendpoint.service");
const threads = require("./thread.service");
const outbox = require("./outbox.service");
const attachments = require("./attachment.service");
const commands = require("./commands.service");
const { cpanelPreset } = require("./autodiscover");
const { asyncHandler } = require("../../../utils/errors");
const { config } = require("../../../config/env");
const actor = (req) => req.user || { user_id: null };
// Mail is LIVE-ONLY, on purpose. A mailbox connection holds real credentials and
// real fetched mail — there is no meaningful "sandbox mailbox," exactly like the
// login identity is not sandboxed. So every mail op uses req.identityDb (pinned
// to the live schema) rather than req.tenantDb (env-scoped). This also removes a
// real footgun: OAuth callbacks are plain browser redirects with no env header,
// so they always wrote to live — a TEST-mode user then saw an empty list while
// their connection sat in live. Pinning reads to live makes the two agree.
const slugOf = (req) => req.tenant && req.tenant.slug;
const msRedirect = (req) => config.MS_GRAPH_REDIRECT_URI || `${req.protocol}://${req.get("host")}${req.baseUrl}/oauth/microsoft/callback`;
const ggRedirect = (req) => config.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get("host")}${req.baseUrl}/oauth/google/callback`;
const { URLSearchParams } = require('url');

// Build the Graph push-notification URL from the TENANT's canonical subdomain,
// not the request host. The OAuth callback can now land on a single canonical
// host (e.g. the apex) with the tenant resolved from the signed state — but a
// webhook has no state, so it must target a host that resolves the tenant on its
// own. `<slug>.<base-domain>` is the tenant's registered subdomain, which the
// host resolver handles normally. (On the legacy subdomain flow this is the same
// host the request already arrived on, so behaviour is unchanged there.)
const msWebhook = (req) => `${req.protocol}://${req.tenant.slug}.${config.APP_BASE_DOMAIN}${req.baseUrl}/webhook/microsoft`;
// After OAuth consent the browser lands on the callback. Send it back to the
// tenant's Mail page — on the TENANT SUBDOMAIN, where the user's session lives
// (the callback itself may have arrived on the apex canonical host, which has no
// session) — carrying a success/error flag the SPA surfaces. Redirect on BOTH
// paths so the user never sees a raw JSON body or an error envelope in the URL bar.
const mailPageUrl = (req, params) => {
  const query = new URLSearchParams(params).toString();
  return `${req.protocol}://${req.tenant.slug}.${config.APP_BASE_DOMAIN}/comms/mail?${query}`;
};

async function finishOAuth(req, res, provider, run) {
  try {
    const r = await req.identityDb((c) => run(c));
    return res.redirect(302, mailPageUrl(req, { mail_connected: provider, email: (r && r.email_address) || "" }));
  } catch (err) {
    return res.redirect(302, mailPageUrl(req, { mail_error: (err && err.code) || "OAUTH_FAILED", provider }));
  }
}

module.exports = {
  // ── Read-only view (original) ──
  senders: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listIdentities(c)) })),
  sent: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listSent(c, req.query)) })),
  inbox: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listInbox(c, req.query)) })),
  updateSender: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.updateIdentity(c, req.params.id, req.body || {})) })),
  upsertSender: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.upsertIdentity(c, req.body || {})) })),
  archiveSender: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.archiveIdentity(c, req.params.id)) })),

  // ── Engine: connections ──
  autodiscover: asyncHandler(async (req, res) => res.json({ data: await service.autodiscover({ email: req.query.email }) })),
  listConnections: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listConnections(c, { ...req.query, ownerUserId: actor(req).user_id })) })),
  connect: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.connect(c, { ...req.body, actor: actor(req) })) })),
  updateConnection: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.updateImapConnection(c, req.params.id, { ...req.body, ownerUserId: actor(req).user_id, actor: actor(req) })) })),
  testConnection: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.testConnection(c, req.params.id)) })),
  syncNow: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.syncConnection(c, req.params.id, { slug: req.tenant && req.tenant.slug })) })),
  setDefaultMailbox: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setDefaultMailbox(c, req.params.id, actor(req).user_id)) })),
  recipients: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.searchRecipients(c, req.query.q)) })),

  // ── Engine: messages ──
  thread: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listThread(c, req.query)) })),
  message: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getMessage(c, req.params.id)) })),
  attachments: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listAttachments(c, req.params.id)) })),
  clientTimeline: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.clientTimeline(c, { client_id: req.params.id, limit: req.query.limit })) })),
  linkThread: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.linkEntity(c, { inboundId: req.params.id, entity_ref: req.body && req.body.entity_ref })) })),
  markRead: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.markRead(c, req.params.id)) })),
  /**
   * Queue a message. 202, not 201 — nothing has been sent yet, and the response
   * says when it will be. A 201 would claim a message exists at the recipient,
   * which is exactly the thing the undo window means is not true.
   */
  send: asyncHandler(async (req, res) => res.status(202).json({
    data: await req.identityDb((c) => outbox.send(c, actor(req), {
      ...req.body, slug: req.tenant && req.tenant.slug,
      idempotency_key: req.get("Idempotency-Key") || req.body.idempotency_key || null,
    })),
  })),
  cancelSend: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => outbox.cancel(c, actor(req), req.params.id)) })),
  outbox: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => outbox.listQueued(c, actor(req), req.query)) })),

  // ── PR-1B: drafts ──
  // Scoped to the AUTHOR, never to the mailbox. Access to a shared mailbox is
  // not authority to read a colleague's unsent words.
  saveDraft: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => outbox.saveDraft(c, actor(req), req.body || {})) })),
  listDrafts: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => outbox.listDrafts(c, actor(req), req.query)) })),
  getDraft: asyncHandler(async (req, res) => {
    const d = await req.identityDb((c) => outbox.getDraft(c, actor(req), req.params.id));
    if (!d) return res.status(404).json({ error: { code: "NOT_FOUND", message: "draft not found" } });
    return res.json({ data: d });
  }),
  discardDraft: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => outbox.discardDraft(c, actor(req), req.params.id)) })),

  // ── PR-1B: attachments on a draft ──
  draftAttachments: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => attachments.list(c, actor(req), req.params.id)) })),
  uploadAttachment: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb((c) => attachments.upload(c, actor(req), { ...req.body, slug: req.tenant && req.tenant.slug })),
  })),
  attachFromVault: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb((c) => attachments.fromVault(c, actor(req), req.body || {})),
  })),
  removeAttachment: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => attachments.remove(c, actor(req), req.params.id, req.params.attachmentId)),
  })),

  // ── PR-1B: slash commands ──
  // The list is filtered per user and the run is checked again: the menu decides
  // what is offered, the check decides what happens, and a client can call run
  // directly whatever the menu showed it.
  commands: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => commands.list(c, actor(req), { lang: req.query.lang })),
  })),
  runCommand: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => commands.run(c, actor(req), req.params.key, req.body?.params || {}, {
      lang: req.body?.lang || req.query.lang,
      boundEntityRef: req.body?.entity_ref || null,
      thread: req.body?.email_thread_id || null,
    })),
  })),
  reply: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.reply(c, { ...req.body, connectionId: req.body.connectionId, inboundId: req.params.id, actor: actor(req) })) })),

  /**
   * What THIS caller may do with mail, answered by the server.
   *
   * The client needs it to decide which Setup sub-tabs to draw. It could guess
   * from the modules it can read, but read-visibility is not the same right as
   * edit, and a tab that always 403s teaches people to distrust the ones that
   * work. So the grant is resolved here, from the same identity cache the route
   * gate uses, and the UI renders what the answer says.
   *
   * The server remains the authority either way — this only decides what is
   * OFFERED. Every endpoint behind those tabs is still gated on its own.
   */
  me: asyncHandler(async (req, res) => {
    const u = req.user || {};
    if (u.is_ceo === true) {
      return res.json({ data: { can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: true } });
    }
    const identityCache = require("../../../shared/cache/identity-cache");
    const grants = await req.identityDb((c) => identityCache.getGrants(c, { role_ids: u.role_ids, module: "MOD-72" }));
    const has = (col) => grants.some((g) => g[col] === true);
    const canEdit = has("can_update");
    return res.json({
      data: {
        can_view: has("can_read"), can_create: has("can_create"),
        can_edit: canEdit, can_administer: canEdit, is_ceo: false,
      },
    });
  }),

  // ── PR-1A: conversations ──
  // Every handler passes the ACTOR through, because read state, stars and label
  // visibility are per user. A thread handler that does not take a user id is a
  // handler that will show one person another person's unread count.
  threads: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.list(c, actor(req), req.query)) })),
  threadGet: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.get(c, actor(req), req.params.id)) })),
  threadRead: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.markRead(c, actor(req), req.params.id, req.body?.on !== false)) })),
  threadStar: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.star(c, actor(req), req.params.id, req.body?.on !== false)) })),
  threadMove: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.move(c, actor(req), req.params.id, req.body.folder)) })),
  threadStream: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.setStream(c, actor(req), req.params.id, req.body.stream)) })),
  threadLabel: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.applyLabel(c, actor(req), req.params.id, req.body.label_id, req.body.on !== false)) })),
  threadBulk: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.bulk(c, actor(req), req.body)) })),
  mailFolders: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.folders(c, actor(req), req.query.connection_id)) })),
  mailLabels: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.labels(c, actor(req))) })),
  createLabel: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => threads.createLabel(c, actor(req), req.body)) })),
  deleteLabel: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => threads.deleteLabel(c, actor(req), req.params.id)) })),

  // ── PR-0: mailbox administration ──
  // Every handler runs on req.identityDb for the same reason the engine does:
  // mail is LIVE-only, and a mailbox configured in TEST mode that the live app
  // cannot see is a footgun, not a sandbox.
  myMailboxes: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.listForUser(c, actor(req).user_id)) })),
  allMailboxes: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.listAll(c, req.query)) })),
  catalogue: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.listCatalogue(c, { includeDisabled: req.query.include_disabled === "true" })) })),
  addCatalogueEntry: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => mailbox.addCatalogueEntry(c, req.body || {}, actor(req))) })),
  toggleCatalogueEntry: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.setCatalogueEnabled(c, req.params.key, req.body.is_enabled, actor(req))) })),
  createShared: asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.connect(c, { ...req.body, kind: "SHARED", actor: actor(req) })) })),
  archiveMailbox: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.archive(c, req.params.id, actor(req))) })),
  handoverMailbox: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.handover(c, req.params.id, { catalogueKey: req.body.catalogue_key || null, department: req.body.department || null, actor: actor(req) })) })),
  setMailboxLimits: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.setLimits(c, req.params.id, req.body || {}, actor(req))) })),
  sendAllowance: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => mailbox.checkSendAllowance(c, req.params.id, Number(req.query.count) || 1)) })),
  cpanel: asyncHandler(async (req, res) => res.json({ data: cpanelPreset(req.query.email) })),

  // ── PR-0: access grants ──
  members: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => access.listMembers(c, req.params.id, { includeRevoked: req.query.include_revoked === "true" })) })),
  grantMember: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb(async (c) => {
      await access.assertCanManage(c, req.params.id, actor(req).user_id);
      return access.grant(c, { connectionId: req.params.id, userId: req.body.user_id, role: req.body.member_role, actor: actor(req) });
    }),
  })),
  revokeMember: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      await access.assertCanManage(c, req.params.id, actor(req).user_id);
      return access.revoke(c, { connectionId: req.params.id, userId: req.params.userId, actor: actor(req) });
    }),
  })),
  accessAudit: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => access.listAudit(c, { connectionId: req.query.connection_id || null, limit: req.query.limit })) })),

  // ── PR-0: send points ──
  sendPoints: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => sendPoints.listResolved(c, { entityId: req.query.entity_id || null })) })),
  bindSendPoint: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => sendPoints.bind(c, {
      sendPointKey: req.params.key, entityId: req.body.entity_id || null,
      identityId: req.body.email_identity_id || null, connectionId: req.body.email_connection_id || null,
      actor: actor(req),
    })),
  })),
  unbindSendPoint: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => sendPoints.unbind(c, { sendPointKey: req.params.key, entityId: req.query.entity_id || null, actor: actor(req) })) })),

  // ── Microsoft 365 OAuth (start is authed; callback + webhook are pre-auth) ──
  msOAuthStart: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.startMicrosoftOAuth(c, { slug: slugOf(req), redirectUri: msRedirect(req), display_name: req.query.display_name, actor: actor(req) })) })),
  msOAuthCallback: asyncHandler((req, res) => finishOAuth(req, res, "microsoft", (c) =>
    service.completeMicrosoftOAuth(c, { code: req.query.code, state: req.query.state, slug: slugOf(req), webhookUrl: msWebhook(req) }))),
  msWebhook: asyncHandler(async (req, res) => {
    if (req.query && req.query.validationToken) return res.type("text/plain").status(200).send(req.query.validationToken);
    const data = await req.identityDb((c) => service.handleGraphNotification(c, req.body, { slug: slugOf(req) }));
    return res.status(202).json({ data });
  }),

  // ── Google Gmail OAuth (start authed; callback pre-auth) ──
  ggOAuthStart: asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.startGoogleOAuth(c, { slug: slugOf(req), redirectUri: ggRedirect(req), display_name: req.query.display_name, actor: actor(req) })) })),
  ggOAuthCallback: asyncHandler((req, res) => finishOAuth(req, res, "google", (c) =>
    service.completeGoogleOAuth(c, { code: req.query.code, state: req.query.state, slug: slugOf(req) }))),
  ggWebhook: asyncHandler(async (req, res) => {
    await req.identityDb((c) => service.handleGmailNotification(c, req.body));
    return res.status(204).send(); // ack the Pub/Sub push
  }),
};
