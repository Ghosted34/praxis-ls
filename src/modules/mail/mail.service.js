/**
 * Mail service.
 *  - Read-only view over per-purpose senders + the outbound log (original).
 *  - Provider-agnostic engine (Phase 1: IMAP/SMTP): connect a mailbox, test it,
 *    sync inbound, send, and reply. Business code calls these — never a provider.
 *
 * Secrets (mailbox password / OAuth bundle) live in the integration_secret
 * setting section (AES-256-GCM), keyed `mail_conn:<connectionId>` — the same vault
 * as email_smtp_pass / whatsapp_token. Never stored on the connection row.
 */
"use strict";
const repo = require("./mail.repo");
const events = require("./mail.events");
const settings = require("../security/setting/setting.service");
const jwt = require("jsonwebtoken");
const { emitEvent } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const { config } = require("../../config/env");
const { ImapSmtpProvider } = require("./providers/imapSmtp.provider");
const { MicrosoftGraphProvider } = require("./providers/microsoftGraph.provider");
const { GmailProvider } = require("./providers/gmail.provider");
const msOAuth = require("./providers/microsoftOAuth");
const googleOAuth = require("./providers/googleOAuth");
const documentVault = require("../vault/document_vault/document_vault.service");
const { publishMailEvent } = require("../../realtime/mail-bus");
const { autodiscover } = require("./autodiscover");

const ATTACH_MAX_BYTES = 25 * 1024 * 1024; // matches document_vault.createDocument
const OAUTH_STATE_TTL = "10m";

/** Sanitize an inbound HTML body before it is ever stored/rendered (stored-XSS
 *  guard — plan §7). Keeps common formatting + inline images (cid:), drops
 *  scripts/handlers/unsafe schemes. Done once on ingest. */
function cleanHtml(html) {
  if (!html) return null;
   
  const sanitize = require("sanitize-html");
  return sanitize(html, {
    allowedTags: sanitize.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitize.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      a: ["href", "name", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
  });
}

// ── Original read-only view ──
const listIdentities = (client) => repo.listIdentities(client);
const listSent = (client, q = {}) => repo.listSentLog(client, { limit: q.limit, offset: q.offset, identityId: q.identity_id });
const listInbox = (client, q = {}) => repo.listInbox(client, { limit: q.limit, offset: q.offset, identityId: q.identity_id });
const updateIdentity = (client, id, fields) => repo.updateIdentity(client, id, fields);
const upsertIdentity = (client, d) => repo.upsertIdentity(client, d);
const archiveIdentity = (client, id) => repo.archiveIdentity(client, id);

// ── Engine helpers ──
const secretKeyFor = (id) => `mail_conn:${id}`;
const fmtFrom = (conn) => (conn.display_name ? `"${conn.display_name}" <${conn.email_address}>` : conn.email_address);

/** Build the right provider adapter for a connection, with its decrypted secret. */
async function resolveAdapter(client, conn) {
  if (conn.provider === "imap_smtp") {
    const password = conn.secret_key ? await settings.readSecret(client, conn.secret_key) : null;
    return new ImapSmtpProvider({
      email_address: conn.email_address,
      from: fmtFrom(conn),
      imap_host: conn.imap_host, imap_port: conn.imap_port, imap_secure: conn.imap_secure,
      smtp_host: conn.smtp_host, smtp_port: conn.smtp_port, smtp_secure: conn.smtp_secure,
      auth_user: conn.auth_user, password,
    });
  }
  if (conn.provider === "microsoft_graph") {
    return new MicrosoftGraphProvider({ getAccessToken: () => oauthAccessToken(client, conn, msOAuth) });
  }
  if (conn.provider === "google_gmail") {
    return new GmailProvider({ emailAddress: conn.email_address, getAccessToken: () => oauthAccessToken(client, conn, googleOAuth) });
  }
  throw new AppError("PROVIDER_UNSUPPORTED", `Provider '${conn.provider}' not available yet`, 400);
}

/** Read the vault token bundle for an OAuth connection; refresh + persist when the
 *  access token is within 60s of expiry. `idp` is the provider's OAuth helper
 *  (microsoftOAuth | googleOAuth) — both expose refresh({refreshToken}). */
async function oauthAccessToken(client, conn, idp) {
  const raw = conn.secret_key ? await settings.readSecret(client, conn.secret_key) : null;
  if (!raw) throw new AppError("NOT_CONNECTED", "no OAuth token bundle for this mailbox", 409);
  let bundle;
  try { bundle = JSON.parse(raw); } catch { throw new AppError("BAD_TOKEN", "corrupt token bundle", 500); }
  if (bundle.expires_at && bundle.expires_at - Date.now() > 60000) return bundle.access_token;

  const refreshed = await idp.refresh({ refreshToken: bundle.refresh_token });
  const next = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || bundle.refresh_token, // MS/Google may omit on refresh
    expires_at: Date.now() + (Number(refreshed.expires_in) || 3600) * 1000,
  };
  await settings.put(client, {
    section: settings.SECRET_SECTION, key: conn.secret_key,
    value: { provider: conn.provider, key_name: "MAIL_CONN", secret: JSON.stringify(next) },
    actor: { user_id: null },
  });
  await repo.updateConnection(client, conn.email_connection_id, { token_expires_at: new Date(next.expires_at) });
  return next.access_token;
}

const listConnections = (client, q = {}) => repo.listConnections(client, q);

/** Connect a mailbox: persist the connection + secret, then live-test it. */
async function connect(client, input = {}) {
  const { email_address, provider = "imap_smtp", display_name, password, actor = {} } = input;
  if (!email_address) throw new AppError("VALIDATION_ERROR", "email_address is required", 422);
  const conn = await repo.insertConnection(client, {
    email_address, provider, display_name: display_name || null,
    imap_host: input.imap_host || null, imap_port: input.imap_port || null,
    imap_secure: input.imap_secure !== false,
    smtp_host: input.smtp_host || null, smtp_port: input.smtp_port || null,
    smtp_secure: input.smtp_secure === true,
    auth_user: input.auth_user || null,
    status: "PENDING",
  });
  const secret_key = secretKeyFor(conn.email_connection_id);
  if (password) {
    await settings.put(client, {
      section: settings.SECRET_SECTION,
      key: secret_key,
      value: { provider, key_name: "MAIL_CONN", secret: password },
      actor,
    });
  }
  await repo.updateConnection(client, conn.email_connection_id, { secret_key });
  const test = await testConnection(client, conn.email_connection_id);
  return { ...conn, secret_key, status: test.ok ? "CONNECTED" : "ERROR", test };
}

/** Live connectivity/auth check; updates status. Never throws. */
async function testConnection(client, id) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  let result;
  try {
    const adapter = await resolveAdapter(client, conn);
    result = await adapter.verify();
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (result.ok) await repo.updateConnection(client, id, { status: "CONNECTED", last_error: null });
  else await repo.setError(client, id, result.error || result.stage || "verify failed");
  return result;
}

/** Pull new inbound for one connection: fetch → dedup-insert → attachments → emit
 *  → advance cursor. `ctx.slug` namespaces vault storage keys (tenant slug). */
async function syncConnection(client, id, ctx = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) return { skipped: true };
  try {
    const adapter = await resolveAdapter(client, conn);
    const { messages, nextCursor } = await adapter.fetchSince(conn.sync_cursor);
    let inserted = 0;
    let attachments = 0;
    for (const m of messages) {
      const row = await repo.insertInbound(client, {
        email_connection_id: conn.email_connection_id,
        email_identity_id: conn.email_identity_id,
        external_message_id: m.externalMessageId,
        thread_key: m.threadKey,
        direction: "IN",
        from_address: m.from,
        to_address: (m.to || []).join(", "),
        subject: m.subject,
        body_preview: m.bodyText,
        body_html: cleanHtml(m.bodyHtml),
        body_text: m.bodyText,
        in_reply_to: m.inReplyTo,
        is_read: m.isRead,
        received_at: m.receivedAt,
      });
      if (row) {
        inserted += 1;
        attachments += await persistAttachments(client, row.email_inbound_id, m.attachments, ctx);
        await autoLink(client, row.email_inbound_id, m.from, m.subject);
        await emitEvent(client, {
          eventTypeKey: events.RECEIVED,
          moduleKey: events.MODULE,
          entityRef: events.msgRef(row.email_inbound_id),
          actorUserId: null,
          payload: { from: m.from, subject: m.subject, connection: conn.email_connection_id, attachments: (m.attachments || []).length },
        });
      }
    }
    await repo.setCursor(client, conn.email_connection_id, nextCursor);
    // Live-notify the tenant's Mail view (worker → Redis bus → web socket).
    if (inserted > 0 && ctx.slug) publishMailEvent(ctx.slug, { connection: conn.email_connection_id, inserted });
    return { connection: conn.email_connection_id, fetched: messages.length, inserted, attachments };
  } catch (err) {
    await repo.setError(client, conn.email_connection_id, err.message);
    return { connection: conn.email_connection_id, error: err.message };
  }
}

/** Store each attachment's bytes in the vault and link it to the message. One bad
 *  attachment (too large / storage error) is skipped, never aborting the sync. */
async function persistAttachments(client, inboundId, list, ctx = {}) {
  if (!list || !list.length) return 0;
  const slug = ctx.slug || "unknown";
  let saved = 0;
  for (const a of list) {
    if (!a || !a.content || !a.content.length || a.content.length > ATTACH_MAX_BYTES) continue;
    try {
      const contentType = a.content_type || "application/octet-stream";
      const dataUrl = `data:${contentType};base64,${a.content.toString("base64")}`;
       
      const doc = await documentVault.createDocument(client, {
        dataUrl, slug, entityRef: `email_inbound:${inboundId}`, docType: null, actor: { user_id: null },
      });
       
      await repo.addAttachment(client, {
        email_inbound_id: inboundId, vault_id: doc.doc_id,
        filename: a.filename || null, content_type: contentType, size_bytes: a.content.length,
      });
      saved += 1;
    } catch {
      /* skip this attachment; bytes may exceed the vault limit or storage failed */
    }
  }
  return saved;
}

/** Send from a connected mailbox; records the OUT copy for the thread view. */
async function send(client, input = {}) {
  const { connectionId, to, cc, subject, html, text, actor = {} } = input;
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  const adapter = await resolveAdapter(client, conn);
  const res = await adapter.sendEmail({ to, cc, subject, bodyHtml: html, bodyText: text });
  await recordOutbound(client, conn, { ...res, to, subject, html, text });
  await emitEvent(client, {
    eventTypeKey: events.SENT, moduleKey: events.MODULE,
    entityRef: events.ref(conn.email_connection_id), actorUserId: actor.user_id || null,
    payload: { to, subject },
  });
  return res;
}

/** Reply to a stored inbound message, keeping it in-thread. */
async function reply(client, input = {}) {
  const { connectionId, inboundId, html, text, actor = {} } = input;
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  const original = await repo.getInbound(client, inboundId);
  if (!original) throw new AppError("NOT_FOUND", "message not found", 404);
  const adapter = await resolveAdapter(client, conn);
  const subject = /^re:/i.test(original.subject || "") ? original.subject : `Re: ${original.subject || ""}`.trim();
  const res = await adapter.createReply(original.external_message_id, {
    to: original.from_address, subject, bodyHtml: html, bodyText: text,
    references: original.thread_key ? [original.thread_key] : [],
  });
  await recordOutbound(client, conn, { ...res, to: original.from_address, subject, html, text });
  await emitEvent(client, {
    eventTypeKey: events.SENT, moduleKey: events.MODULE,
    entityRef: events.msgRef(inboundId), actorUserId: actor.user_id || null,
    payload: { to: original.from_address, subject, in_reply_to: original.external_message_id },
  });
  return res;
}

async function recordOutbound(client, conn, m) {
  await repo.insertInbound(client, {
    email_connection_id: conn.email_connection_id,
    email_identity_id: conn.email_identity_id,
    external_message_id: m.externalMessageId,
    thread_key: m.threadKey,
    direction: "OUT",
    from_address: conn.email_address,
    to_address: Array.isArray(m.to) ? m.to.join(", ") : m.to,
    subject: m.subject,
    body_preview: m.text,
    body_html: m.html,
    body_text: m.text,
    is_read: true,
    received_at: new Date(),
  });
}

// ── OAuth providers (Microsoft 365 + Google Gmail) ──
// One flow, parameterised by provider. Each entry supplies its IdP helper, a
// state `purpose` tag, and a probe adapter to resolve the mailbox address.
const OAUTH = {
  microsoft_graph: { idp: msOAuth, purpose: "ms_oauth", probe: (tok) => new MicrosoftGraphProvider({ getAccessToken: async () => tok }) },
  google_gmail: { idp: googleOAuth, purpose: "gg_oauth", probe: (tok) => new GmailProvider({ getAccessToken: async () => tok }) },
};

/** Step 1: return the provider consent URL. State is a signed JWT binding the
 *  provider + tenant slug + initiating user + redirect (CSRF + tenant pinning). */
function startOAuth(_client, provider, { slug, redirectUri, display_name = null, actor = {} }) {
  const o = OAUTH[provider];
  if (!o) throw new AppError("PROVIDER_UNSUPPORTED", `Unknown OAuth provider '${provider}'`, 400);
  if (!o.idp.isConfigured()) throw new AppError("NOT_CONFIGURED", `${provider} OAuth is not configured`, 400);
  if (!slug || !redirectUri) throw new AppError("VALIDATION_ERROR", "slug and redirectUri are required", 422);
  const state = jwt.sign(
    { purpose: o.purpose, provider, slug, user_id: actor.user_id || null, display_name, redirectUri },
    config.JWT_ACCESS_SECRET, { expiresIn: OAUTH_STATE_TTL },
  );
  return { url: o.idp.authorizeUrl({ state, redirectUri }) };
}

/** Step 2: exchange the code, resolve the mailbox, upsert the connection, store
 *  the token bundle in the vault. Runs on the tenant DB resolved from the host. */
async function completeOAuth(client, provider, { code, state, slug, webhookUrl }) {
  const o = OAUTH[provider];
  if (!o) throw new AppError("PROVIDER_UNSUPPORTED", `Unknown OAuth provider '${provider}'`, 400);
  let claims;
  try { claims = jwt.verify(state, config.JWT_ACCESS_SECRET); } catch { throw new AppError("BAD_STATE", "invalid or expired OAuth state", 400); }
  if (claims.purpose !== o.purpose || claims.provider !== provider) throw new AppError("BAD_STATE", "wrong state purpose/provider", 400);
  if (slug && claims.slug && slug !== claims.slug) throw new AppError("TENANT_MISMATCH", "OAuth state is for a different tenant", 400);

  const tokens = await o.idp.exchangeCode({ code, redirectUri: claims.redirectUri });
  const expires_at = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;

  const who = await o.probe(tokens.access_token).verify();
  if (!who.ok || !who.email) throw new AppError("OAUTH_PROBE_FAILED", who.error || "could not read mailbox", 502);

  let conn = await repo.findByAddress(client, who.email, provider);
  if (!conn) {
    conn = await repo.insertConnection(client, {
      email_address: who.email, provider, display_name: claims.display_name || null,
      status: "CONNECTED", token_expires_at: new Date(expires_at),
    });
  } else {
    await repo.updateConnection(client, conn.email_connection_id, { status: "CONNECTED", last_error: null, token_expires_at: new Date(expires_at) });
  }

  const secret_key = secretKeyFor(conn.email_connection_id);
  await settings.put(client, {
    section: settings.SECRET_SECTION, key: secret_key,
    value: { provider, key_name: "MAIL_CONN", secret: JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at }) },
    actor: { user_id: claims.user_id || null },
  });
  await repo.updateConnection(client, conn.email_connection_id, { secret_key });
  await setupPush(client, conn.email_connection_id, provider, { webhookUrl }).catch(() => { /* push optional; polling covers it */ });
  return { email_connection_id: conn.email_connection_id, email_address: who.email, provider, status: "CONNECTED" };
}

/** Best-effort push registration after connect. Graph → change subscription to our
 *  webhook; Gmail → Cloud Pub/Sub watch (only if GOOGLE_PUBSUB_TOPIC is set).
 *  Failures are swallowed by the caller — delta polling remains the safety net. */
async function setupPush(client, connId, provider, { webhookUrl } = {}) {
  const conn = await repo.getConnection(client, connId);
  const adapter = await resolveAdapter(client, conn);
  if (provider === "microsoft_graph" && webhookUrl) {
    const sub = await adapter.subscribe({ notificationUrl: webhookUrl, clientState: connId });
    if (sub) await repo.updateConnection(client, connId, { push_subscription_id: sub.subscriptionId, push_expires_at: sub.expiresAt ? new Date(sub.expiresAt) : null });
  } else if (provider === "google_gmail" && config.GOOGLE_PUBSUB_TOPIC) {
    const w = await adapter.watch({ topicName: config.GOOGLE_PUBSUB_TOPIC });
    const patch = { push_subscription_id: w.subscriptionId, push_expires_at: w.expiresAt || null };
    if (w.historyId) patch.sync_cursor = { history_id: String(w.historyId) };
    await repo.updateConnection(client, connId, patch);
  }
}

/** Renew push subscriptions nearing expiry (Graph ~3d, Gmail ~7d). Worker-driven. */
async function renewSubscriptions(client) {
  const due = await repo.listRenewable(client, 24);
  const results = [];
  for (const conn of due) {
    try {
       
      const adapter = await resolveAdapter(client, conn);
       
      const r = await adapter.renewSubscription(conn.push_subscription_id);
       
      if (r && r.expiresAt) await repo.updateConnection(client, conn.email_connection_id, { push_expires_at: new Date(r.expiresAt) });
      results.push({ connection: conn.email_connection_id, ok: true });
    } catch (err) {
      results.push({ connection: conn.email_connection_id, error: err.message });
    }
  }
  return { renewed: results.length, results };
}

/** Gmail Cloud Pub/Sub push → sync the mailbox named in the decoded payload. */
async function handleGmailNotification(client, body) {
  const dataB64 = body && body.message && body.message.data;
  if (!dataB64) return { ignored: true };
  // G-6: a Gmail Pub/Sub push carries the `subscription` we watched. Only accept
  // pushes from our configured topic — a forged/spurious push is dropped before
  // any decode/lookup. (The subscription is the deployment's GOOGLE_PUBSUB_TOPIC
  // with a Pub/Sub subscription id suffix, so a prefix match on the project/topic.)
  const subscription = (body && body.subscription) || "";
  if (config.GOOGLE_PUBSUB_TOPIC && subscription && !subscription.includes(config.GOOGLE_PUBSUB_TOPIC)) {
    return { ignored: true };
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8")); } catch { return { ignored: true }; }
  const conn = await repo.findByAddress(client, payload.emailAddress, "google_gmail");
  if (!conn) return { ignored: true };
  return syncConnection(client, conn.email_connection_id, {});
}

const startMicrosoftOAuth = (client, opts) => startOAuth(client, "microsoft_graph", opts);
const completeMicrosoftOAuth = (client, opts) => completeOAuth(client, "microsoft_graph", opts);
const startGoogleOAuth = (client, opts) => startOAuth(client, "google_gmail", opts);
const completeGoogleOAuth = (client, opts) => completeOAuth(client, "google_gmail", opts);

/** Graph webhook notifications → sync the affected connections now. `clientState`
 *  we set at subscribe time is the connection id; fall back to a full sync. */
async function handleGraphNotification(client, body, ctx = {}) {
  const notes = (body && body.value) || [];
  const ids = new Set(notes.map((n) => n.clientState).filter(Boolean));
  const results = [];
  if (ids.size) {
    for (const id of ids) {
      // G-6: `clientState` is the connection id we set at subscribe time. Only
      // sync ids that resolve to a real, connected mailbox in THIS tenant — a
      // forged clientState (or a stale one) is skipped instead of triggering
      // work. The per-tenant DB scopes the lookup, so this also proves the
      // connection belongs here. Best-effort: a bad id never aborts the batch.
      let conn = null;
      try { conn = await repo.getConnection(client, id); } catch { /* skip */ }
      if (!conn || conn.status !== "CONNECTED") continue;
      results.push(await syncConnection(client, conn.email_connection_id, ctx));
    }
  }
  return { notified: notes.length, synced: results.length, results };
}

/** Best-effort CRM link on ingest: a dossier ref in the subject wins (most
 *  specific), else the sender's client. Tags entity_ref so the message shows on
 *  the dossier / client timeline. Never throws into the sync loop. */
async function autoLink(client, inboundId, fromAddress, subject) {
  try {
    const refs = String(subject || "").match(/[A-Za-z0-9]{2,}-\d{4}-\d{2,}/g) || [];
    if (refs.length) {
      const d = await repo.findDossierByRefs(client, refs);
      if (d) { await repo.setEntityRef(client, inboundId, `dossier:${d.dossier_id}`); return; }
    }
    const cl = await repo.findClientByEmail(client, fromAddress);
    if (cl) await repo.setEntityRef(client, inboundId, `client:${cl.client_id}`);
  } catch { /* linking is best-effort */ }
}

const listThread = (client, q = {}) => repo.listInboundByConnection(client, { connectionId: q.connection_id, limit: q.limit, before: q.before });
const getMessage = (client, id) => repo.getInbound(client, id);
/** Mark a message read locally AND propagate to the mail server (G-3). The
 *  adapter's markAsRead is best-effort — a live mailbox must reflect the state,
 *  but a transient provider failure must never block the local read flip. */
async function markRead(client, id) {
  const msg = await repo.getInbound(client, id);
  if (!msg) throw new AppError("NOT_FOUND", "message not found", 404);
  if (msg.email_connection_id && msg.external_message_id) {
    try {
      const conn = await repo.getConnection(client, msg.email_connection_id);
      if (conn && conn.status === "CONNECTED") {
        const adapter = await resolveAdapter(client, conn);
        await adapter.markAsRead(msg.external_message_id);
      }
    } catch (err) {
      // server mark is best-effort; still record the local read state
      try {
        const { logger } = require("../../config/logger");
        logger.warn({ err, id }, "[mail] markAsRead propagation skipped");
      } catch { /* noop */ }
    }
  }
  return repo.markInboundRead(client, id);
}
const listAttachments = (client, id) => repo.listAttachments(client, id);
/** Mail timeline for a client (Phase 3 CRM). Accepts a client id or an entity_ref. */
const clientTimeline = (client, { client_id, entity_ref, limit } = {}) =>
  repo.timelineByEntity(client, entity_ref || `client:${client_id}`, { limit });

/** Manually attach a message to any entity (e.g. 'dossier:<id>' or 'client:<id>'). */
async function linkEntity(client, { inboundId, entity_ref }) {
  if (!inboundId || !entity_ref) throw new AppError("VALIDATION_ERROR", "inboundId and entity_ref are required", 422);
  await repo.setEntityRef(client, inboundId, entity_ref);
  return { email_inbound_id: inboundId, entity_ref };
}

module.exports = {
  listIdentities, listSent, listInbox, updateIdentity, upsertIdentity, archiveIdentity,
  listConnections, connect, testConnection, syncConnection, send, reply, listThread, getMessage, markRead, listAttachments,
  clientTimeline, linkEntity, autodiscover,
  startMicrosoftOAuth, completeMicrosoftOAuth, handleGraphNotification,
  startGoogleOAuth, completeGoogleOAuth, handleGmailNotification, renewSubscriptions,
  resolveAdapter,
};
