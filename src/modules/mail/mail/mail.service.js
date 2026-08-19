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
const settings = require("../../security/setting/setting.service");
const jwt = require("jsonwebtoken");
const { emitEvent } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
// Shared SMTP-error classifier — the connection-test path and the system-email
// paths (email.service, platform probes) share one map so the UI's fix guides
// key off the same codes everywhere. See smtp-error.map.js.
const { mapSmtpError, isSmtpError } = require("./smtp-error.map");
const { config } = require("../../../config/env");
const { ImapSmtpProvider } = require("./providers/imapSmtp.provider");
const { MicrosoftGraphProvider } = require("./providers/microsoftGraph.provider");
const { GmailProvider } = require("./providers/gmail.provider");
const msOAuth = require("./providers/microsoftOAuth");
const googleOAuth = require("./providers/googleOAuth");
const documentVault = require("../../vault/document_vault/document_vault.service");
const { publishMailEvent } = require("../../../realtime/mail-bus");
const { autodiscover } = require("./autodiscover");
// PR-0 foundation. The engine now asks three questions before it sends: may this
// person send as this mailbox (access), is the mailbox within its host's rate
// limit (mailbox.checkSendAllowance), and what stamp goes on the wire (origin).
const access = require("./access");
const mailbox = require("./mailbox.service");
const origin = require("./origin");
const threading = require("./threading");
const folders = require("./folders");
const stream = require("./stream");
const threadRepo = require("./thread.repo");

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
async function upsertIdentity(client, d) {
  const identity = await repo.upsertIdentity(client, d);
  // Sections bind the sender to ERP send points (WS-E3). `undefined` = leave
  // bindings untouched; an empty array clears them.
  if (d.sections !== undefined && identity && identity.email_identity_id) {
    await repo.setBindingsForIdentity(client, identity.email_identity_id, d.sections);
  }
  return identity;
}
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
const setDefaultMailbox = (client, id, ownerUserId) => repo.setDefaultConnection(client, id, ownerUserId);
const searchRecipients = (client, q) => repo.searchRecipients(client, q);

/** Connect a mailbox: persist the connection + secret, then live-test it. */
/**
 * Which providers a tenant may actually connect right now.
 *
 * The Microsoft Graph and Gmail adapters are built, tested and working, and their
 * tests keep running in CI so they do not rot. They are simply not part of this
 * programme: the decision was to do ONE provider properly first, and the one the
 * first tenant runs is cPanel IMAP/SMTP. Gating here rather than deleting the
 * adapters means re-enabling them is a feature flag, not a rewrite — and it means
 * hiding the buttons in the UI is not the only thing standing between a curious
 * caller and a half-supported provider.
 */
const OAUTH_PROVIDERS = new Set(["microsoft_graph", "google_gmail"]);

async function assertProviderEnabled(client, provider) {
  if (!OAUTH_PROVIDERS.has(provider)) return;
  const { rows } = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = $1",
    ["mail.provider.oauth"],
  );
  if (!rows[0] || rows[0].state !== "on") {
    throw new AppError(
      "PROVIDER_NOT_ENABLED",
      "Microsoft 365 and Google mailboxes are not enabled yet. Connect your mailbox with its IMAP/SMTP settings — if your company uses cPanel, the setup wizard fills these in for you.",
      403,
    );
  }
}

async function connect(client, input = {}) {
  const { email_address, provider = "imap_smtp", display_name, password, actor = {} } = input;
  if (!email_address) throw new AppError("VALIDATION_ERROR", "email_address is required", 422);
  await assertProviderEnabled(client, provider);
  // One personal mailbox per person (PR-0 Q1). The partial unique index in 10723
  // is the enforcement; this turns a 23505 into a sentence naming the mailbox
  // they already have and what to do instead.
  const kind = input.kind === "SHARED" ? "SHARED" : "PERSONAL";
  if (kind === "PERSONAL" && actor.user_id) await mailbox.assertNoPersonalMailbox(client, actor.user_id);
  const conn = await repo.insertConnection(client, {
    email_address, provider, display_name: display_name || null,
    imap_host: input.imap_host || null, imap_port: input.imap_port || null,
    imap_secure: input.imap_secure !== false,
    smtp_host: input.smtp_host || null, smtp_port: input.smtp_port || null,
    smtp_secure: input.smtp_secure === true,
    auth_user: input.auth_user || null,
    owner_user_id: actor.user_id || null,
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
  // Stamp WHAT this mailbox is (personal vs a team address, which entity it
  // belongs to, who may work it). The transport row above knows how to reach the
  // server; this is the part administration cares about.
  await mailbox.classify(client, conn.email_connection_id, {
    kind,
    catalogueKey: kind === "SHARED" ? input.catalogue_key || null : null,
    entityId: input.entity_id || null,
    department: input.department || null,
    actor,
  });
  if (kind === "PERSONAL") await repo.ensureDefaultConnection(client, actor.user_id);
  const created = await repo.getConnection(client, conn.email_connection_id);
  return { ...created, secret_key, status: test.ok ? "CONNECTED" : "ERROR", test };
}

/** Edit an IMAP/SMTP connection's transport/credentials, then re-test. OAuth
 *  mailboxes are provider-managed and not editable here. Owner-scoped. */
async function updateImapConnection(client, id, input = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  if (conn.provider !== "imap_smtp") throw new AppError("NOT_EDITABLE", "Only IMAP/SMTP mailboxes can be edited; Microsoft/Google mailboxes are managed by the provider.", 400);
  if (input.ownerUserId && conn.owner_user_id && conn.owner_user_id !== input.ownerUserId) {
    throw new AppError("FORBIDDEN", "You can only edit your own mailboxes", 403);
  }
  const patch = {};
  for (const k of ["email_address", "display_name", "imap_host", "imap_port", "imap_secure", "smtp_host", "smtp_port", "smtp_secure", "auth_user"]) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  if (Object.keys(patch).length) await repo.updateConnection(client, id, patch);
  if (input.password) {
    const secret_key = conn.secret_key || secretKeyFor(id);
    await settings.put(client, {
      section: settings.SECRET_SECTION, key: secret_key,
      value: { provider: "imap_smtp", key_name: "MAIL_CONN", secret: input.password },
      actor: input.actor || {},
    });
    if (!conn.secret_key) await repo.updateConnection(client, id, { secret_key });
  }
  const test = await testConnection(client, id);
  const updated = await repo.getConnection(client, id);
  return { ...updated, status: test.ok ? "CONNECTED" : "ERROR", test };
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
    // Classify SMTP verdicts so the UI can render the matching fix guide.
    const mapped = isSmtpError(err) ? mapSmtpError(err) : null;
    result = { ok: false, error: mapped ? mapped.message : err.message };
    if (mapped) result.code = mapped.code;
  }
  if (result.ok) await repo.updateConnection(client, id, { status: "CONNECTED", last_error: null });
  else await repo.setError(client, id, result.error || result.stage || "verify failed");
  return result;
}

/** Pull new inbound for one connection: fetch → dedup-insert → attachments → emit
 *  → advance cursor. `ctx.slug` namespaces vault storage keys (tenant slug). */
/**
 * Discover the folders a mailbox has, and record which ones we will sync.
 *
 * Runs on every sync rather than only on connect, because a folder can be
 * created at any time and a Sent folder that appears next month should start
 * syncing without anyone reconnecting the mailbox.
 */
async function discoverFolders(client, conn, adapter, ctx = {}) {
  if (!adapter.listFolders) {
    // An adapter with no folder support still has an inbox. Guarantee the row so
    // the rest of the loop has something to iterate.
    return [await threadRepo.upsertFolder(client, conn.email_connection_id, {
      canonical: "INBOX", provider_path: "INBOX", display_name: "Inbox", is_syncable: true,
    })];
  }
  const limit = Number((await mailbox.tenantLimits(client)).folder_sync_limit) || 25;
  const listed = await adapter.listFolders();
  const mapped = folders.mapFolders(listed, { limit });
  const rows = [];
  for (const f of mapped) {
    const before = await threadRepo.upsertFolder(client, conn.email_connection_id, f);
    rows.push(before);
    if (f.is_syncable && !before.last_sync_at) {
      await emitEvent(client, {
        eventTypeKey: "email.folder.discovered", moduleKey: events.MODULE,
        entityRef: events.ref(conn.email_connection_id), actorUserId: null,
        payload: { folder: f.canonical || f.provider_path, mailbox: conn.email_address },
      }).catch(() => { /* @silent:storage the folder row is the outcome */ });
    }
  }
  return threadRepo.syncableFolders(client, conn.email_connection_id);
}

/**
 * Ingest one normalized message into the thread model.
 *
 * Returns the inserted message row, or null when it was already stored — the
 * dedup index is what makes a re-scan after a UIDVALIDITY change cheap instead of
 * duplicating a mailbox.
 */
async function ingestMessage(client, conn, m, { folder = "INBOX", providerPath = null, rules = [], ctx = {} }) {
  const direction = m.direction === "OUT" ? "OUT" : "IN";
  const originFields = origin.originFieldsFor({
    direction, headers: m.headers, messageIdHeader: m.messageIdHeader || m.externalMessageId || null,
  });

  // The conversation this belongs to. Provider thread ids are trusted only when
  // the adapter says it really has them.
  const capabilities = typeof conn.capabilities === "function" ? conn.capabilities() : {};
  const threadKey = threading.threadKeyFor(
    { ...m, messageIdHeader: originFields.message_id_header }, capabilities,
  ) || m.externalMessageId;

  // Classify once, on the first message of a conversation. A known party always
  // wins — see stream.js. Only inbound mail is classified: something we sent is
  // by definition human.
  const existing = await threadRepo.upsertThread(client, {
    email_connection_id: conn.email_connection_id,
    thread_key: threadKey,
    ...threading.foldIntoThread(null, m),
    message_count: 0,
  });

  let streamFields = {};
  if (existing.message_count === 0 && direction === "IN") {
    const party = await threadRepo.knownParty(client, m.from);
    const verdict = stream.classify({
      headers: m.headers, fromAddress: m.from, subject: m.subject, knownParty: party, rules,
    });
    streamFields = { stream: verdict.stream, stream_reason: verdict.reason, is_vip: Boolean(party && party.is_vip) };
  }

  const row = await threadRepo.insertMessage(client, {
    email_thread_id: existing.email_thread_id,
    email_connection_id: conn.email_connection_id,
    email_identity_id: conn.email_identity_id,
    external_message_id: m.externalMessageId,
    message_id_header: originFields.message_id_header,
    direction,
    folder,
    provider_folder: providerPath,
    from_address: m.from || "unknown@unknown",
    from_name: m.fromName || null,
    to_address: m.to || [],
    cc_address: m.cc || [],
    subject: m.subject,
    body_html: cleanHtml(m.bodyHtml),
    body_text: m.bodyText,
    in_reply_to: m.inReplyTo,
    references_header: threading.normaliseReferences(m.references),
    size_bytes: m.sizeBytes || null,
    has_attachment: Boolean((m.attachments || []).length),
    sent_via: originFields.sent_via,
    origin_user_id: originFields.origin_user_id,
    origin_send_point: originFields.origin_send_point,
    received_at: m.receivedAt,
  });
  if (!row) return null;

  // Fold the message into its thread, then recount from the messages so the
  // summary is derived and cannot drift out of step with what is actually there.
  await threadRepo.updateThread(client, existing.email_thread_id, {
    ...threading.foldIntoThread(existing, m),
    ...streamFields,
  });
  await threadRepo.refreshThreadCounts(client, existing.email_thread_id);
  await threadRepo.seedStateForMembers(client, row.email_message_id, conn.email_connection_id);
  // The sender already read what they sent; only inbound arrives unread.
  if (direction === "OUT" && originFields.origin_user_id) {
    await threadRepo.setThreadRead(client, originFields.origin_user_id, existing.email_thread_id, true).catch(() => {
      /* @silent:storage read state is a convenience here, not the record */
    });
  }
  return { ...row, thread_id: existing.email_thread_id, is_new_thread: existing.message_count === 0 };
}

/** Pull new mail for one connection, folder by folder. */
async function syncConnection(client, id, ctx = {}) {
  const conn = await repo.getConnection(client, id);
  if (!conn) return { skipped: true };
  let adapter;
  try {
    adapter = await resolveAdapter(client, conn);
  } catch (err) {
    await repo.setError(client, conn.email_connection_id, err.message);
    await mailbox.markSyncFailure(client, conn.email_connection_id, err.message);
    return { connection: conn.email_connection_id, error: err.message };
  }

  let syncFolders;
  try {
    syncFolders = await discoverFolders(client, conn, adapter, ctx);
  } catch (err) {
    await repo.setError(client, conn.email_connection_id, err.message);
    await mailbox.markSyncFailure(client, conn.email_connection_id, err.message);
    return { connection: conn.email_connection_id, error: err.message };
  }

  const rules = await threadRepo.streamRules(client);
  let inserted = 0;
  let fetched = 0;
  let attachments = 0;
  const perFolder = [];
  let anyFolderSucceeded = false;
  let lastError = null;

  for (const folder of syncFolders) {
    try {
      // Per-folder cursor. UIDVALIDITY is a per-mailbox value in IMAP, so one
      // cursor shared across folders makes a renumber in Spam look like a
      // renumber in Inbox — see folders.js and migration 10732.
      const { messages, nextCursor } = await adapter.fetchSince(folder.sync_cursor, folder.provider_path);
      fetched += messages.length;
      for (const m of messages) {
        const row = await ingestMessage(client, conn, m, {
          folder: folder.canonical || "ARCHIVE",
          providerPath: folder.provider_path,
          rules, ctx,
        });
        if (!row) continue;
        inserted += 1;
        attachments += await persistAttachments(client, row.email_message_id, m.attachments, ctx);
        await autoLink(client, row.thread_id, m.from, m.subject);
        await emitEvent(client, {
          eventTypeKey: row.is_new_thread ? "email.thread.created" : events.RECEIVED,
          moduleKey: events.MODULE,
          entityRef: events.msgRef(row.email_message_id),
          actorUserId: null,
          payload: {
            from: m.from, subject: m.subject, folder: folder.canonical,
            connection: conn.email_connection_id, attachments: (m.attachments || []).length,
          },
        });
      }
      await threadRepo.setFolderCursor(client, folder.email_folder_id, nextCursor);
      perFolder.push({ folder: folder.canonical || folder.provider_path, fetched: messages.length });
      anyFolderSucceeded = true;
    } catch (err) {
      // One bad folder must never abort its siblings — the same per-connection
      // discipline the engine already had, one level down.
      lastError = err.message;
      await threadRepo.setFolderError(client, folder.email_folder_id, err.message);
      perFolder.push({ folder: folder.canonical || folder.provider_path, error: err.message });
    }
  }

  if (anyFolderSucceeded) {
    await mailbox.markSyncSuccess(client, conn.email_connection_id);
  } else if (lastError) {
    await repo.setError(client, conn.email_connection_id, lastError);
    const h = await mailbox.markSyncFailure(client, conn.email_connection_id, lastError);
    if (h && h.consecutive_failures === 3) {
      await emitEvent(client, {
        eventTypeKey: "mailbox.health.failed", moduleKey: events.MODULE,
        entityRef: events.ref(conn.email_connection_id), actorUserId: null,
        payload: { address: conn.email_address, error: lastError, failures: h.consecutive_failures },
      }).catch(() => { /* @silent:storage the sync error is already recorded on the row */ });
    }
  }

  if (inserted > 0 && ctx.slug) publishMailEvent(ctx.slug, { connection: conn.email_connection_id, inserted });
  return { connection: conn.email_connection_id, fetched, inserted, attachments, folders: perFolder };
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
        dataUrl, slug, entityRef: `email_message:${inboundId}`, docType: null, actor: { user_id: null },
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
/** Translate a raw SMTP/provider send failure into a message that puts the blame
 *  where it belongs — the connected mailbox's OWN server/config, not Praxis. It
 *  returns a 4xx AppError so the error monitor classifies it as a mailbox-config
 *  issue rather than a server/code fault, and the compose UI shows the user why. */
function explainSendError(err, conn) {
  const raw = String((err && (err.response || err.message)) || "").trim();
  const addr = (conn && conn.email_address) || "this mailbox";
  // Same classifier as Test / system-email / probes. Mailbox send only overlays
  // the connected address so compose names which mailbox to Edit. Codes and
  // status (including RECIPIENT_REJECTED 422, which the outbox must not retry)
  // come from the map — wrapping everything leftover as MAIL_SEND_FAILED would
  // hide a permanent recipient refusal as a retryable 502.
  const mapped = mapSmtpError(err);
  if (mapped.code === "SENDER_NOT_AUTHORIZED") {
    return new AppError(
      "SENDER_NOT_AUTHORIZED",
      `Your mailbox ${addr} isn't an authorised sender on its own mail server, so the server refused the message`
        + (raw ? ` (${raw})` : "")
        + `. This is the mailbox's SMTP setup — not Praxis. The "From" address must be a real mailbox on that server and usually has to match the login you connected with. Open Comms → Mailbox → Edit on this mailbox to fix the address, login or password, then Test.`,
      422,
      mapped.details,
    );
  }
  if (mapped.code === "SMTP_AUTH_FAILED") {
    return new AppError("MAILBOX_AUTH_FAILED", `Login to ${addr} was rejected by its mail server${raw ? ` (${raw})` : ""}. Edit this mailbox to correct the username or password, then Test.`, 422);
  }
  if (mapped.code === "RECIPIENT_REJECTED") {
    return new AppError(
      "RECIPIENT_REJECTED",
      `${addr}'s mail server refused a recipient${raw ? ` (${raw})` : ""}. Check the To/Cc addresses.`,
      422,
      mapped.details,
    );
  }
  return new AppError(
    "MAIL_SEND_FAILED",
    `${addr}'s mail server rejected the message${raw ? `: ${raw}` : ""}. This came from the mailbox's server, not Praxis.`,
    mapped.status || 502,
    mapped.details,
  );
}

/**
 * The three checks every outbound message passes, in this order.
 *
 * ACCESS first, because refusing early is the cheapest refusal and because
 * "you may not send as billing@" should not depend on the rate limiter's mood.
 * THROTTLE second: a mailbox over its host's hourly cap gets its message HELD
 * for the next window rather than refused — crossing a cPanel cap suspends the
 * mailbox, and failing the send instead just teaches people to use Outlook.
 * STAMP last, so the headers describe the send that is actually happening.
 */
async function prepareSend(client, conn, { actor = {}, sendPoint = null, slug = null, to = null, subject = null }) {
  if (actor.user_id) await access.assertCanSend(client, conn.email_connection_id, actor.user_id);

  const allowance = await mailbox.checkSendAllowance(client, conn.email_connection_id, 1);
  if (!allowance.allowed) {
    await emitEvent(client, {
      eventTypeKey: "mail.send.throttled", moduleKey: events.MODULE,
      entityRef: events.ref(conn.email_connection_id), actorUserId: actor.user_id || null,
      payload: { reason: allowance.reason, limit: allowance.limit, retry_at: allowance.retryAt },
    }).catch(() => { /* @silent:storage the throttle verdict is what matters, not its event */ });
    throw new AppError(
      "SEND_RATE_LIMIT",
      allowance.reason === "DAILY_LIMIT"
        ? `${conn.email_address} has reached its daily send limit of ${allowance.limit}. Sending resumes after midnight UTC. Raise the limit in Comms → Setup → Defaults and limits if the mail host allows more.`
        : `${conn.email_address} has reached its hourly send limit of ${allowance.limit}. Sending resumes at ${new Date(allowance.retryAt).toISOString().slice(11, 16)} UTC. This limit exists because most shared hosts suspend a mailbox that exceeds theirs.`,
      429,
      { retry_at: allowance.retryAt, limit: allowance.limit, reason: allowance.reason },
    );
  }

  const messageId = origin.generateMessageId(conn.email_address);
  const headers = origin.buildOriginHeaders({
    tenantSlug: slug, userId: actor.user_id || null,
    sendPoint: sendPoint || "user.compose", connectionId: conn.email_connection_id,
  });
  return { messageId, headers, actor, sendPoint, to, subject };
}

/** Book-keeping every successful send does, whatever path produced it. */
async function afterSend(client, conn, prep) {
  await mailbox.recordSent(client, conn.email_connection_id, 1);
  if (conn.kind === "SHARED" || conn.kind === "DELEGATED") {
    await access.recordSentAs(client, {
      connectionId: conn.email_connection_id, actor: prep.actor,
      to: prep.to, subject: prep.subject, sendPoint: prep.sendPoint,
    });
  }
}

async function send(client, input = {}) {
  const { connectionId, to, cc, subject, html, text, actor = {}, sendPoint = null, slug = null } = input;
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  const prep = await prepareSend(client, conn, { actor, sendPoint, slug, to, subject });
  const adapter = await resolveAdapter(client, conn);
  let res;
  try {
    res = await adapter.sendEmail({
      to, cc, subject, bodyHtml: html, bodyText: text,
      messageId: prep.messageId, headers: prep.headers,
    });
  } catch (err) {
    throw explainSendError(err, conn);
  }
  await afterSend(client, conn, prep);
  await recordOutbound(client, conn, {
    ...res, to, subject, html, text,
    messageIdHeader: prep.messageId, sentVia: origin.SENT_VIA.PRAXIS,
    originUserId: actor.user_id || null, originSendPoint: prep.sendPoint || "user.compose",
  });
  await emitEvent(client, {
    eventTypeKey: events.SENT, moduleKey: events.MODULE,
    entityRef: events.ref(conn.email_connection_id), actorUserId: actor.user_id || null,
    payload: { to, subject },
  });
  return res;
}

/** Reply to a stored inbound message, keeping it in-thread. */
async function reply(client, input = {}) {
  const { connectionId, inboundId, html, text, actor = {}, sendPoint = null, slug = null } = input;
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  const original = await threadRepo.getMessage(client, actor.user_id || null, inboundId);
  if (!original) throw new AppError("NOT_FOUND", "message not found", 404);
  const subject = /^re:/i.test(original.subject || "") ? original.subject : `Re: ${original.subject || ""}`.trim();
  const prep = await prepareSend(client, conn, { actor, sendPoint, slug, to: original.from_address, subject });
  const adapter = await resolveAdapter(client, conn);
  let res;
  try {
    res = await adapter.createReply(original.external_message_id, {
      to: original.from_address, subject, bodyHtml: html, bodyText: text,
      references: original.references_header || [],
      inReplyTo: original.message_id_header || original.external_message_id,
      messageId: prep.messageId, headers: prep.headers,
    });
  } catch (err) {
    throw explainSendError(err, conn);
  }
  await afterSend(client, conn, prep);
  await recordOutbound(client, conn, {
    ...res, to: original.from_address, subject, html, text,
    messageIdHeader: prep.messageId, sentVia: origin.SENT_VIA.PRAXIS,
    originUserId: actor.user_id || null, originSendPoint: prep.sendPoint || "user.compose",
  });
  await emitEvent(client, {
    eventTypeKey: events.SENT, moduleKey: events.MODULE,
    entityRef: events.msgRef(inboundId), actorUserId: actor.user_id || null,
    payload: { to: original.from_address, subject, in_reply_to: original.external_message_id },
  });
  return res;
}

async function recordOutbound(client, conn, m) {
  // A sent message is a message like any other: it joins (or starts) a thread and
  // lands in SENT. Recording it here rather than waiting for the Sent-folder sync
  // means it appears immediately, and the dedup index absorbs the copy the sync
  // brings back a minute later.
  const to = Array.isArray(m.to) ? m.to : String(m.to || "").split(/[,;]\s*/).filter(Boolean);
  const threadKey = threading.threadKeyFor({
    references: m.references, inReplyTo: m.inReplyTo,
    messageIdHeader: m.messageIdHeader || m.externalMessageId,
  }) || m.threadKey || m.externalMessageId;

  const thread = await threadRepo.upsertThread(client, {
    email_connection_id: conn.email_connection_id,
    thread_key: threadKey,
    subject: threading.baseSubject(m.subject),
    participants: [conn.email_address, ...to].filter(Boolean).map((a) => String(a).toLowerCase()),
    first_message_at: new Date(), last_message_at: new Date(),
    message_count: 0,
  });

  const row = await threadRepo.insertMessage(client, {
    email_thread_id: thread.email_thread_id,
    email_connection_id: conn.email_connection_id,
    email_identity_id: conn.email_identity_id,
    external_message_id: m.externalMessageId,
    message_id_header: m.messageIdHeader || null,
    direction: "OUT",
    folder: "SENT",
    from_address: conn.email_address,
    to_address: to,
    subject: m.subject,
    body_html: m.html,
    body_text: m.text,
    sent_via: m.sentVia || null,
    origin_user_id: m.originUserId || null,
    origin_send_point: m.originSendPoint || null,
    received_at: new Date(),
  });
  if (row) {
    await threadRepo.refreshThreadCounts(client, thread.email_thread_id);
    await threadRepo.seedStateForMembers(client, row.email_message_id, conn.email_connection_id);
    if (m.originUserId) {
      await threadRepo.setThreadRead(client, m.originUserId, thread.email_thread_id, true).catch(() => {
        /* @silent:storage the sender having "read" their own send is a nicety */
      });
    }
  }
  return row;
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
      owner_user_id: claims.user_id || null,
      status: "CONNECTED", token_expires_at: new Date(expires_at),
    });
  } else {
    await repo.updateConnection(client, conn.email_connection_id, { status: "CONNECTED", last_error: null, token_expires_at: new Date(expires_at) });
    await repo.claimConnectionIfUnowned(client, conn.email_connection_id, claims.user_id);
  }

  const secret_key = secretKeyFor(conn.email_connection_id);
  await settings.put(client, {
    section: settings.SECRET_SECTION, key: secret_key,
    value: { provider, key_name: "MAIL_CONN", secret: JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at }) },
    actor: { user_id: claims.user_id || null },
  });
  await repo.updateConnection(client, conn.email_connection_id, { secret_key });
  await repo.ensureDefaultConnection(client, claims.user_id);
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
      try { conn = await repo.getConnection(client, id); } catch { /* @silent:storage — a stale/forged connection id in a batch is skipped, not fatal */ }
      if (!conn || conn.status !== "CONNECTED") continue;
      results.push(await syncConnection(client, conn.email_connection_id, ctx));
    }
  }
  return { notified: notes.length, synced: results.length, results };
}

/** Best-effort CRM link on ingest: a dossier ref in the subject wins (most
 *  specific), else the sender's client. Tags entity_ref so the message shows on
 *  the dossier / client timeline. Never throws into the sync loop. */
async function autoLink(client, threadId, fromAddress, subject) {
  try {
    const refs = String(subject || "").match(/[A-Za-z0-9]{2,}-\d{4}-\d{2,}/g) || [];
    if (refs.length) {
      const d = await repo.findDossierByRefs(client, refs);
      if (d) { await threadRepo.updateThread(client, threadId, { entity_ref: `dossier:${d.dossier_id}` }); return; }
    }
    const cl = await repo.findClientByEmail(client, fromAddress);
    if (cl) await threadRepo.updateThread(client, threadId, { entity_ref: `client:${cl.client_id}` });
  } catch { /* @silent:teardown — CRM auto-link is best-effort; a failed link never aborts the sync loop */ }
}

/** Legacy flat message list, kept for the AI catalogue and the 360 timeline. */
const listThread = (client, q = {}) =>
  threadRepo.listThreads(client, q.user_id || null, { connectionId: q.connection_id, limit: q.limit, before: q.before });
const getMessage = (client, id, userId = null) => threadRepo.getMessage(client, userId, id);
/** Mark a message read locally AND propagate to the mail server (G-3). The
 *  adapter's markAsRead is best-effort — a live mailbox must reflect the state,
 *  but a transient provider failure must never block the local read flip. */
async function markRead(client, id, actorUserId = null) {
  const msg = await threadRepo.getMessage(client, null, id);
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
        const { logger } = require("../../../config/logger");
        logger.warn({ err, id }, "[mail] markAsRead propagation skipped");
      } catch { /* @silent:teardown — logging a warn must never mask the original error */ }
    }
  }
  return threadRepo.setThreadRead(client, actorUserId, msg.email_thread_id, true).then(() => ({ email_message_id: id, is_read: true }));
}
const listAttachments = (client, id) => repo.listAttachments(client, id);
/** Mail timeline for a client (Phase 3 CRM). Accepts a client id or an entity_ref. */
const clientTimeline = (client, { client_id, entity_ref, limit } = {}) =>
  threadRepo.timelineByEntity(client, entity_ref || `client:${client_id}`, { limit });

/** Manually attach a message to any entity (e.g. 'dossier:<id>' or 'client:<id>'). */
async function linkEntity(client, { inboundId, entity_ref }) {
  if (!inboundId || !entity_ref) throw new AppError("VALIDATION_ERROR", "inboundId and entity_ref are required", 422);
  // Bind the CONVERSATION, not the single message: a dossier reference in one
  // reply is about the whole exchange, and binding message-by-message is how half
  // a thread ends up on a client's timeline.
  const msg = await threadRepo.getMessage(client, null, inboundId);
  const threadId = (msg && msg.email_thread_id) || inboundId;
  await threadRepo.updateThread(client, threadId, { entity_ref });
  return { email_thread_id: threadId, entity_ref };
}

module.exports = {
  listIdentities, listSent, listInbox, updateIdentity, upsertIdentity, archiveIdentity,
  listConnections, setDefaultMailbox, connect, updateImapConnection, testConnection, syncConnection, send, reply, listThread, getMessage, markRead, listAttachments,
  clientTimeline, linkEntity, autodiscover, searchRecipients,
  startMicrosoftOAuth, completeMicrosoftOAuth, handleGraphNotification,
  startGoogleOAuth, completeGoogleOAuth, handleGmailNotification, renewSubscriptions,
  // Exported for the send-queue flusher, which injects them rather than
  // importing this module — outbox.service must stay loadable, and testable,
  // without dragging in every provider adapter.
  resolveAdapter, recordOutbound, explainSendError,
};
