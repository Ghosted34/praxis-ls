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
const mailNotify = require("./mail-notify.service");
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
const { autodiscover, hostedProviderOf } = require("./autodiscover");
const routeCheck = require("../deliverability/route-check");
// PR-0 foundation. The engine now asks three questions before it sends: may this
// person send as this mailbox (access), is the mailbox within its host's rate
// limit (mailbox.checkSendAllowance), and what stamp goes on the wire (origin).
const access = require("./access");
const mailbox = require("./mailbox.service");
const origin = require("./origin");
const threading = require("./threading");
// For `holds` — the grant check the slash-command menu already uses. Same cache,
// same CEO rule and same columns as requirePermission; a second copy of a
// permission check is a second thing to forget to update.
const commands = require("./commands.service");
const folders = require("./folders");
const stream = require("./stream");
const threadRepo = require("./thread.repo");
const triageHooks = require("../triage/ingest-hooks");
const followupService = require("../triage/followup.service");
const intake = require("../binding/intake.service");
const semantic = require("../assist/semantic.service");
const ocrQueue = require("../assist/ocr.enqueue");

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
// C-3: `userId` threads through to the repo, which scopes the list by it.
const listInbox = (client, q = {}) =>
  repo.listInbox(client, { limit: q.limit, offset: q.offset, identityId: q.identity_id, userId: q.userId || null });
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

/**
 * The SENDING leg's own secret, when it has one.
 *
 * A SECOND vault entry beside `mail_conn:<id>`, not a second field inside it.
 * The existing entry is read by three code paths and holds an OAuth token
 * bundle for two of the three providers; widening its value shape would make
 * every one of those readers care about a key that means nothing to them. A
 * separate key means the absent case needs no migration and no parsing — the
 * row is simply not there, which is exactly the question the mode asks.
 */
const smtpSecretKeyFor = (id) => `mail_conn_smtp:${id}`;

const fmtFrom = (conn) => (conn.display_name ? `"${conn.display_name}" <${conn.email_address}>` : conn.email_address);

/** Build the right provider adapter for a connection, with its decrypted secret. */
async function resolveAdapter(client, conn) {
  if (conn.provider === "imap_smtp") {
    const password = conn.secret_key ? await settings.readSecret(client, conn.secret_key) : null;
    // Absent for every mailbox that shares one credential, which is every
    // mailbox connected before 13777. `readSecret` answers null for a key with
    // no row, so this needs no guard and no column to tell it whether to look.
    const smtpPassword = await settings.readSecret(client, smtpSecretKeyFor(conn.email_connection_id));
    return new ImapSmtpProvider({
      email_address: conn.email_address,
      from: fmtFrom(conn),
      imap_host: conn.imap_host, imap_port: conn.imap_port, imap_secure: conn.imap_secure,
      smtp_host: conn.smtp_host, smtp_port: conn.smtp_port, smtp_secure: conn.smtp_secure,
      auth_user: conn.auth_user, password,
      smtp_user: conn.smtp_user, smtp_password: smtpPassword,
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
/**
 * Which address books this caller may read, by grant.
 *
 * `commands.service.holds` rather than a third implementation: it is the same
 * cache, the same CEO rule and the same columns as `requirePermission`, and a
 * second copy of a permission check is a second thing to forget to update.
 *
 * Resolved in parallel — four cached lookups on a keystroke-driven endpoint.
 */
async function allowedRecipientSources(client, user) {
  const checks = await Promise.all(
    repo.RECIPIENT_SOURCES.map(async (src) => (
      (await commands.holds(client, user, src.module, "view")) ? src.type : null
    )),
  );
  return checks.filter(Boolean);
}

/**
 * Search the recipient picker's address books.
 *
 * ⚠ `user` is REQUIRED for this to return anything. It used to take only the
 * term, and the route's MOD-72 grant — "you may use mail" — was the only thing
 * between a signed-in user and every address in the tenant, staff included.
 * A caller that passes no user now gets an empty list rather than everything,
 * which is the safe direction for a signature this shape to fail in.
 */
async function searchRecipients(client, q, { user = null } = {}) {
  if (!user) return [];
  return repo.searchRecipients(client, q, { sources: await allowedRecipientSources(client, user) });
}

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

/**
 * Per-provider flags, added in 12775 alongside the original umbrella key.
 *
 * The two providers stopped being ready at the same time. Microsoft is now the
 * ONLY way a Microsoft 365 tenant can connect a mailbox — Exchange Online
 * removed Basic auth for IMAP/POP in 2022 and retired it for SMTP AUTH in April
 * 2026 — while Google's restricted mail scopes still need a security assessment
 * that runs for weeks. One switch for both would hold Microsoft behind Google
 * for no reason.
 *
 * EITHER key answers: a provider is on when its own flag is on, OR when the
 * umbrella `mail.provider.oauth` is. So a tenant that already has the umbrella
 * switched on is unaffected, and the console can now enable Microsoft alone.
 */
const PROVIDER_FLAGS = {
  microsoft_graph: "mail.provider.microsoft",
  google_gmail: "mail.provider.google",
};

/**
 * Is this provider switched on for the tenant? The QUESTION behind
 * `assertProviderEnabled`, split out so a screen can ASK it instead of finding
 * out by being refused.
 *
 * The chooser modal ("how is this mailbox hosted?") has to render the Microsoft
 * option before anybody clicks anything, and the only honest way to draw it is
 * to know whether it would work. Offering a live button that answers 403, or
 * hiding the option so a Microsoft 365 tenant sees only the password form that
 * cannot ever work for them, are both worse than saying which switch is off.
 */
async function providerEnabled(client, provider) {
  if (!OAUTH_PROVIDERS.has(provider)) return true;
  const keys = [PROVIDER_FLAGS[provider], "mail.provider.oauth"].filter(Boolean);
  const { rows } = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = ANY($1)",
    [keys],
  );
  return rows.some((r) => r && r.state === "on");
}

/**
 * What the connect chooser may offer, and — when it may not — WHICH of the two
 * independent things is missing.
 *
 * They fail for different people. "Not switched on for this tenant" is a
 * feature flag an administrator flips in the Platform Console; "not configured
 * on this deployment" is an Entra app registration whoever runs the server has
 * to create, and an Entra client SECRET EXPIRES, so a deployment that worked
 * last quarter can be in the second state with nobody having changed anything.
 * A single "unavailable" would send an administrator hunting for a switch that
 * is already on.
 *
 * IMAP/SMTP is always offered: it is the path that needs no deploy-wide
 * credential at all. Whether the ADDRESS can use it is a different question,
 * answered per address by `assertPasswordAuthPossible` — a Microsoft-hosted
 * domain is refused there, by name, rather than being hidden here.
 */
/**
 * `idp.isConfigured()`, for an `idp` that may answer either way.
 *
 * ── THE CRASH THIS FIXES ────────────────────────────────────────────────────
 *
 * This was `idp.isConfigured().catch(() => false)`, and it took the whole
 * endpoint down with `TypeError: idp.isConfigured(...).catch is not a
 * function` — so the chooser could not be drawn at all, on every surface, for
 * every tenant.
 *
 * The two adapters do not agree on the shape. Microsoft's is `async` because
 * it resolves its credentials from the platform vault (a DB read); Google's is
 * a synchronous `Boolean(config.GOOGLE_CLIENT_ID && …)` off `.env`, and a
 * boolean has no `.catch`. `startOAuth` already knew this and says so — "await
 * on the still-synchronous Google adapter is a no-op, so one call shape keeps
 * serving both" — and `await` is exactly the operator that does not care.
 * `.catch()` is not: it is a Promise method, reached before any await.
 *
 * So: `await` inside `try`, which normalises both return shapes AND both
 * failure shapes — a rejected promise from the vault read, and a synchronous
 * throw, which `.catch()` could never have caught either. Failing to `false`
 * is the honest answer: a provider whose configuration cannot be read is one
 * this tenant cannot connect through, and the chooser says so and still offers
 * the IMAP/SMTP route, rather than 500-ing the page that was supposed to
 * explain the problem.
 */
async function isConfiguredSafely(idp) {
  try {
    return Boolean(await idp.isConfigured());
  } catch {
    /* @silent:storage the platform vault being unreachable makes the provider
       unavailable, which is a state this endpoint reports rather than throws */
    return false;
  }
}

async function listConnectMethods(client) {
  const oauth = async (provider, idp) => {
    const [enabled, configured] = await Promise.all([
      providerEnabled(client, provider),
      isConfiguredSafely(idp),
    ]);
    return {
      available: enabled && configured,
      enabled,
      configured,
      reason: enabled && configured
        ? null
        : !enabled
          ? "NOT_ENABLED"
          : "NOT_CONFIGURED",
    };
  };
  const [microsoft_graph, google_gmail] = await Promise.all([
    oauth("microsoft_graph", msOAuth),
    oauth("google_gmail", googleOAuth),
  ]);
  return {
    imap_smtp: { available: true, enabled: true, configured: true, reason: null },
    microsoft_graph,
    google_gmail,
  };
}

async function assertProviderEnabled(client, provider) {
  if (!OAUTH_PROVIDERS.has(provider)) return;
  if (!(await providerEnabled(client, provider))) {
    throw new AppError(
      "PROVIDER_NOT_ENABLED",
      "Microsoft 365 and Google mailboxes are not switched on for this tenant yet — they connect over "
        + "OAuth, which an administrator enables. Microsoft and Google no longer accept a password on "
        + "IMAP or SMTP, so there is no interim setting that would work for one of those mailboxes. A "
        + "mailbox on your company's own mail server can still be connected with its IMAP/SMTP settings "
        + "— if that server runs cPanel, the setup wizard fills them in for you.",
      403,
    );
  }
}

/**
 * Refuse a PASSWORD for a mailbox whose provider no longer accepts one.
 *
 * Microsoft and Google both finished removing Basic authentication from the
 * legacy mail protocols:
 *
 *   • Exchange Online disabled Basic auth for POP and IMAP in 2022, and retired
 *     it for Client Submission (SMTP AUTH) on 30 April 2026. App Passwords were
 *     built on Basic auth and went with it.
 *   • Google removed "less secure app" password sign-in for Gmail and Workspace.
 *
 * So for a domain whose MX points at either of them, `imap_smtp` + a password
 * cannot ever succeed — not with the mailbox password, not with an app password.
 * Without this guard the attempt is still made, and what comes back is a bare
 * AUTHENTICATIONFAILED from the provider. That reads as "you typed your password
 * wrong", so the person retypes it, tries an app password, and eventually asks
 * their IT team to check the account — none of which can help, because the
 * protocol itself is closed. Worse, the host they are most likely to enter is
 * `mail.<their-domain>`, which for a domain whose website we host resolves to
 * OUR server: they then authenticate against a local mailbox that is not theirs
 * and see an empty inbox that looks like a working connection.
 *
 * Detection is by MX (`hostedProviderOf`), so it covers a custom domain — the
 * case that matters, since nobody is confused about @outlook.com. It fails OPEN:
 * a resolver failure returns null and the connection proceeds exactly as before,
 * because a DNS hiccup must never block a mailbox that would have worked.
 */
const OAUTH_ONLY = {
  microsoft: {
    label: "Microsoft 365",
    detail: "Microsoft disabled password sign-in for IMAP and POP in 2022 and for SMTP in April 2026.",
  },
  google: {
    label: "Google Workspace / Gmail",
    detail: "Google removed password sign-in for external mail apps.",
  },
};

async function assertPasswordAuthPossible({ email_address, provider }) {
  if (provider !== "imap_smtp") return;
  const hosted = await hostedProviderOf(email_address);
  const oauthOnly = hosted && OAUTH_ONLY[hosted.key];
  if (!oauthOnly) return;
  throw new AppError(
    "MAILBOX_OAUTH_REQUIRED",
    `This address is hosted on ${oauthOnly.label}, which cannot be connected with a password. `
      + `${oauthOnly.detail} It has to be connected by signing in to ${oauthOnly.label} instead — ask an `
      + "administrator to switch on Microsoft 365 and Google mailboxes for this tenant.",
    422,
    { hosted_provider: hosted.key, detected_from: hosted.source },
  );
}

/**
 * Put a connection into "same as IMAP" or "different credentials" mode.
 *
 * ── WHY ONE FUNCTION FOR BOTH CREATE AND EDIT ───────────────────────────────
 *
 * The rules are identical on both paths and every one of them is a rule about
 * pairs: a stored SMTP password with no username, or a username left behind on a
 * row whose password has been cleared, are both configurations nobody chose and
 * both send one leg's user with the other leg's secret. Written twice they would
 * drift on the first change to either.
 *
 * ── THE THREE INPUTS, AND WHY `undefined` IS NOT `"same"` ───────────────────
 *
 *   smtp_auth "separate" — store the password when one was typed; write the
 *                          username. A BLANK password keeps the stored one, the
 *                          same convention `password` has always had, so an edit
 *                          that only moves the SMTP host does not demand a
 *                          credential the operator cannot re-read.
 *   smtp_auth "same"     — DELETE the vault entry and null `smtp_user`. Leaving
 *                          the secret would orphan it: unreachable through the
 *                          UI, still decryptable on disk, and read again the
 *                          moment somebody switched back.
 *   smtp_auth absent     — TOUCH NOTHING. A PATCH that carries only
 *                          `display_name` must not silently destroy a working
 *                          relay credential, and every client that predates this
 *                          field sends exactly that.
 */
async function applySmtpCredentialMode(client, connectionId, input = {}, actor = {}) {
  const mode = input.smtp_auth;
  if (mode === undefined) return;
  const key = smtpSecretKeyFor(connectionId);

  if (mode === "same") {
    try {
      await settings.remove(client, { section: settings.SECRET_SECTION, key, actor });
    } catch (err) {
      // A secret that is already absent IS the state being asked for. Anything
      // else is a real storage failure and must not be swallowed.
      if (err && err.code !== "NOT_FOUND") throw err;
    }
    await repo.updateConnection(client, connectionId, { smtp_user: null });
    return;
  }

  if (input.smtp_password) {
    await settings.put(client, {
      section: settings.SECRET_SECTION,
      key,
      value: { provider: "imap_smtp", key_name: "MAIL_CONN_SMTP", secret: input.smtp_password },
      actor,
    });
  }
  if (input.smtp_user !== undefined) {
    await repo.updateConnection(client, connectionId, { smtp_user: input.smtp_user || null });
  }
}

/**
 * A separate sending credential needs BOTH halves before it can be stored.
 *
 * Checked here rather than only in the validator because the validator cannot
 * see the vault: on an edit a blank password is legitimate when one is already
 * stored and a refusal when none is, and only the server knows which. The
 * message names the field, since "Invalid body" on a form with two new inputs
 * is a guess.
 */
async function assertSmtpCredentialsComplete(client, connectionId, input = {}) {
  if (input.smtp_auth !== "separate") return;
  if (!input.smtp_user) {
    throw new AppError("VALIDATION_ERROR", "smtp_user: a separate sending sign-in needs its username", 422, {
      smtp_user: ["Required when sending uses different credentials"],
    });
  }
  if (input.smtp_password) return;
  const stored = connectionId ? await repo.hasSmtpCredentials(client, connectionId) : false;
  if (!stored) {
    throw new AppError("VALIDATION_ERROR", "smtp_password: a separate sending sign-in needs its password", 422, {
      smtp_password: ["Required when sending uses different credentials"],
    });
  }
}

async function connect(client, input = {}) {
  const { email_address, provider = "imap_smtp", display_name, password, actor = {} } = input;
  if (!email_address) throw new AppError("VALIDATION_ERROR", "email_address is required", 422);
  await assertProviderEnabled(client, provider);
  // Before any row is written or any secret is vaulted: a Microsoft/Google
  // mailbox cannot be reached with a password, whatever was typed into the form.
  await assertPasswordAuthPossible({ email_address, provider });
  // One personal mailbox per person (PR-0 Q1). The partial unique index in 10723
  // is the enforcement; this turns a 23505 into a sentence naming the mailbox
  // they already have and what to do instead.
  const kind = input.kind === "SHARED" ? "SHARED" : "PERSONAL";
  if (kind === "PERSONAL" && actor.user_id) await mailbox.assertNoPersonalMailbox(client, actor.user_id);
  // Before the row exists: on CREATE there is no stored secret to fall back on,
  // so an incomplete separate sign-in is refused here rather than producing a
  // mailbox that is in "different credentials" mode with no credential. First
  // because it is the only one of the two that needs no query.
  await assertSmtpCredentialsComplete(client, null, input);
  // The other way this INSERT can hit a unique index, turned into a sentence for
  // the same reason `assertNoPersonalMailbox` is one: 23505 reaches the user as
  // "A record with these values already exists", which names neither the address
  // nor what to do. `ux_email_connection_address_live` (13776) is the authority;
  // this only says out loud what it is about to refuse. An ARCHIVED row does not
  // count — retiring a mailbox releases its address, which is the whole point of
  // that migration.
  const taken = await repo.findByAddress(client, email_address, provider);
  if (taken && taken.status !== "ARCHIVED") {
    throw new AppError(
      "MAILBOX_ADDRESS_IN_USE",
      `${email_address} is already connected to this company. Open it from Comms → Setup to edit or disconnect it, or retire it first if you want to connect it afresh.`,
      409,
      { email_address, email_connection_id: taken.email_connection_id },
    );
  }
  const conn = await repo.insertConnection(client, {
    email_address, provider, display_name: display_name || null,
    imap_host: input.imap_host || null, imap_port: input.imap_port || null,
    imap_secure: input.imap_secure !== false,
    smtp_host: input.smtp_host || null, smtp_port: input.smtp_port || null,
    smtp_secure: input.smtp_secure === true,
    auth_user: input.auth_user || null,
    // NULL unless the sending leg signs in separately — applySmtpCredentialMode
    // below writes it, and only in "separate" mode, so a username can never be
    // stored without the password that makes it mean something.
    smtp_user: null,
    owner_user_id: actor.user_id || null,
    // The row must be BORN with its kind. `classify` below stamps the rest of the
    // classification (catalogue slot, entity, department, visibility) and can do
    // that a statement later — but `kind` cannot wait, because
    // `ux_email_connection_one_personal` is a partial index ON THIS INSERT:
    //
    //   UNIQUE (owner_user_id) WHERE kind = 'PERSONAL' AND status <> 'ARCHIVED'
    //
    // and `email_connection.kind` DEFAULTS to 'PERSONAL' (10723). Omitting it
    // therefore made every new row — a team address included — momentarily a
    // second personal mailbox for its creator, which the index rejects. Anyone
    // who already had a personal mailbox could not create a SHARED one at all:
    // the INSERT raised 23505 and the error handler rendered it as "A record
    // with these values already exists", naming neither the mailbox in the way
    // nor the rule. The guard above deliberately skips SHARED; the index did not.
    kind,
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
  // BEFORE the test: the test is what tells the operator whether the credentials
  // work, so it has to run against the ones they just typed.
  await applySmtpCredentialMode(client, conn.email_connection_id, input, actor);
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
  return {
    ...created,
    ...(await smtpAuthShape(client, conn.email_connection_id)),
    secret_key,
    status: test.ok ? "CONNECTED" : "ERROR",
    test,
  };
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
  // Refused BEFORE anything is written, so a half-typed separate sign-in cannot
  // leave the mailbox with a host change applied and a credential missing.
  await assertSmtpCredentialsComplete(client, id, input);
  const patch = {};
  // `smtp_user` is deliberately NOT in this list. It is written only by
  // applySmtpCredentialMode, which is the one place that knows whether the row
  // is supposed to have one at all — copying it here would let a username be
  // saved onto a mailbox in "same as IMAP" mode.
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
  await applySmtpCredentialMode(client, id, input, input.actor || {});
  const test = await testConnection(client, id);
  const updated = await repo.getConnection(client, id);
  return { ...updated, ...(await smtpAuthShape(client, id)), status: test.ok ? "CONNECTED" : "ERROR", test };
}

/**
 * The two derived fields the form reopens on, and the secret is not one of them.
 *
 * A GET must be able to say "this mailbox sends with its own sign-in" without
 * ever handing back what that sign-in is — the same rule the mailbox password
 * has always followed. `smtp_user` is on the row and rides along with it; the
 * password only ever appears as a boolean.
 */
async function smtpAuthShape(client, id) {
  const present = await repo.hasSmtpCredentials(client, id);
  return { has_smtp_credentials: present, smtp_auth: present ? "separate" : "same" };
}

/**
 * Live connectivity/auth check; updates status. Never throws.
 *
 * The result carries `stage` ("imap" | "smtp") and, when the mailbox has one, the
 * fact that the sending leg signs in separately — because the question the
 * operator is actually asking is "which password is wrong", and a verdict that
 * cannot answer it is the ambiguity that made the original failure unreadable.
 * The adapter's own messages name the leg; `smtp_auth` here lets a client mark
 * the right field without parsing prose.
 */
async function testConnection(client, id) {
  const conn = await repo.getConnection(client, id);
  if (!conn) throw new AppError("NOT_FOUND", "connection not found", 404);
  const separateSmtpCredentials = conn.provider === "imap_smtp"
    ? await repo.hasSmtpCredentials(client, id)
    : false;
  let result;
  try {
    const adapter = await resolveAdapter(client, conn);
    result = await adapter.verify();
  } catch (err) {
    // Classify SMTP verdicts so the UI can render the matching fix guide.
    const mapped = isSmtpError(err) ? mapSmtpError(err, { separateSmtpCredentials }) : null;
    result = { ok: false, error: mapped ? mapped.message : err.message };
    if (mapped) result.code = mapped.code;
  }
  if (!result.ok) result.smtp_auth = separateSmtpCredentials ? "separate" : "same";
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
        // Attachments BEFORE the archive hook, and their hashes go into it:
        // the chain's content hash covers headers + body + attachment hashes
        // (§9.6), so archiving first would seal a message with its attachments
        // left out of the seal.
        const att = await persistAttachments(client, row.email_message_id, m.attachments, ctx);
        attachments += att.saved;
        // PR-5 §9.6/§9.7/§9.8 — archive, verdict, DSN. One call site, so the
        // wiring test has one thing to assert on and a later edit to this loop
        // has one thing to preserve. Archive failures propagate to the
        // per-folder catch below; the other two are advisory (see the file).
        // `ctx` carries the per-run memo the anti-spoof corpus is read into.
        await triageHooks.onMessageIngested(client, row, { raw: m, attachmentHashes: att.hashes, ctx });
        // PR-3 §7.6 — propose a filing for each attachment. SUGGESTIONS only:
        // "never file silently, at any confidence, in this programme." Advisory,
        // so a classification failure never costs the message.
        if (att.saved) {
          await intake.suggestForMessage(client, {
            messageId: row.email_message_id, threadId: row.thread_id, subject: m.subject,
          }).catch(() => { /* @silent:storage the attachment row is the outcome */ });
          // PR-4 §8.6 — queue field extraction for anything that already looks
          // like a supplier invoice, receipt, PO, proof of payment or cheque.
          // NOT during a backfill: `last_sync_at` is null exactly once per
          // folder, and that pass can be 90 days deep. See ocr.enqueue.js — the
          // narrowing there is the difference between a feature and a bill.
          await ocrQueue.forMessage(client, {
            messageId: row.email_message_id,
            subject: m.subject,
            ctx,
            isFirstSync: !folder.last_sync_at,
          }).catch(() => { /* @silent:storage extraction is an enrichment */ });
        }
        await autoLink(client, {
          threadId: row.thread_id, messageId: row.email_message_id,
          fromAddress: m.from, subject: m.subject, bodyText: m.bodyText,
          filenames: (m.attachments || []).map((a) => a.filename).filter(Boolean),
        });
        // A client reply cancels every pending boomerang on the thread (§9.3,
        // "silently"). The rule lives in followup.service so the sweep and the
        // ingest path cannot drift — the inline copy that used to be here only
        // cancelled NO_REPLY, leaving a multi-step sequence to keep nagging
        // about a client who had already answered.
        //
        // The `typeof client.query === "function"` guard that also stood here
        // was shaped by a unit-test fixture with no `query`, not by anything the
        // runtime does; the fixture now answers, so the guard has gone with it.
        if (m.direction !== "OUT") {
          await followupService.cancelOnReply(client, row.thread_id)
            .catch(() => { /* @silent:storage a missing table during rollout must not abort ingest */ });
        }
        // PR-4 §8.9 — re-embed the thread so "search by meaning" can find it.
        // Gated inside on the tenant's `ai.vectorization` flag, so a tenant that
        // has not opted into embedding never has its correspondence vectorised
        // — which for the most sensitive corpus in the product is the whole
        // point of the flag. Best-effort by construction: an embedding vendor
        // being down must not be what stops a mailbox syncing.
        await semantic.onThreadUpdated(client, row.thread_id);
        await emitEvent(client, {
          // Symmetric, on the THREAD grain, matching the family 10735 seeds.
          //
          // The else branch used to emit `email.received` — the pre-thread
          // engine's message-grain key — which left `email.thread.replied`
          // seeded, described as "a new message joined an existing
          // conversation", and emitted by nothing. The two are synonyms for the
          // same moment and only one of them can be the answer, so a rule on
          // "somebody replied" could never fire. `categoryFor` keys on the
          // domain (`email`), so notification routing is unchanged by this.
          eventTypeKey: row.is_new_thread ? "email.thread.created" : "email.thread.replied",
          moduleKey: events.MODULE,
          entityRef: events.msgRef(row.email_message_id),
          actorUserId: null,
          payload: {
            from: m.from, subject: m.subject, folder: folder.canonical,
            connection: conn.email_connection_id, attachments: (m.attachments || []).length,
          },
        });
        // "A mail arrived" → the people who work this mailbox get told, on
        // every channel they have turned on, including a push to a phone with
        // the app closed. This is a SEPARATE call and not a NOTIFIABLE entry
        // against the event above, because the event above fires for outbound
        // too and its audience would be "everyone holding MOD-64 view" rather
        // than "whoever holds this mailbox". See mail-notify.service.js.
        //
        // Best-effort by contract — it swallows its own failures — but awaited,
        // so the in-app row joins the sync's transaction exactly as every other
        // producer's does.
        await mailNotify.onInboundMessage(client, { conn, message: m, row, ctx });
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

  // Anything the per-run cap held back goes out now, as one digest for this
  // mailbox. After the folder loop because the cap is per mailbox per run, not
  // per folder — a runaway spread over four folders is still one runaway.
  await mailNotify.flushRun(client, { conn, ctx });

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


/**
 * Store each attachment's bytes in the vault and link it to the message. One bad
 * attachment (too large / storage error) is skipped, never aborting the sync.
 *
 * ── EVERY ATTACHMENT IS HASHED, AND THE HASHES ARE RETURNED ─────────────────
 *
 * `checksum_sha256` was written on the OUTBOUND path (outbox.repo) and left
 * null on ingest, which quietly hollowed out the archive: §9.6 defines the
 * content hash as SHA-256 over canonicalised "headers + body + attachment
 * hashes", so with no attachment hashes the chain covered the covering letter
 * and not the invoice. Someone could replace an attached PDF in the vault and
 * `/mail/archive/verify` would still report the chain intact — which is the one
 * thing an auditor is relying on it not to do.
 *
 * Computed here rather than in the archive hook because this is the only place
 * that holds the BYTES; by the time the hook runs there is a vault reference and
 * nothing to hash.
 *
 * @returns {{saved:number, hashes:string[]}} hashes in attachment order.
 */
async function persistAttachments(client, inboundId, list, ctx = {}) {
  if (!list || !list.length) return { saved: 0, hashes: [] };
  const slug = ctx.slug || "unknown";
  const crypto = require("crypto");
  let saved = 0;
  const hashes = [];
  for (const a of list) {
    if (!a || !a.content || !a.content.length || a.content.length > ATTACH_MAX_BYTES) continue;
    try {
      const contentType = a.content_type || "application/octet-stream";
      const checksum = crypto.createHash("sha256").update(a.content).digest("hex");
      const dataUrl = `data:${contentType};base64,${a.content.toString("base64")}`;

      const doc = await documentVault.createDocument(client, {
        dataUrl, slug, entityRef: `email_message:${inboundId}`, docType: null, actor: { user_id: null },
      });

      await repo.addAttachment(client, {
        // `email_message_id`, not `email_inbound_id` — 10737 renamed it. The
        // old name failed this INSERT inside the @silent catch below, so every
        // inbound attachment was stored in the vault and then orphaned.
        email_message_id: inboundId, direction: "IN", vault_id: doc.doc_id,
        filename: a.filename || null, content_type: contentType, size_bytes: a.content.length,
        checksum_sha256: checksum,
      });
      hashes.push(checksum);
      saved += 1;
    } catch {
      /* @silent:storage skip this attachment; bytes may exceed the vault limit or storage failed */
    }
  }
  return { saved, hashes };
}

/** Send from a connected mailbox; records the OUT copy for the thread view. */

/**
 * The mailbox-specific wording, per verdict from the shared classifier.
 *
 * `smtp-error.map.js` decides WHAT went wrong, by evidence, for every outbound
 * path in the product — Test, system email, the platform probe, and this one.
 * These rows only decide HOW TO SAY IT when the failure happened on a person's
 * own connected mailbox, where the fix is a screen they can open rather than a
 * server they do not run.
 *
 * ── EACH ROW BUILDS ITS OWN AppError, AND THAT IS DELIBERATE ────────────────
 *
 * It would be tidier to return `{ message }` and let the caller assemble the
 * error from the map's code and status. It would also make the codes
 * invisible: `scripts/generate-api-docs.js` finds every error this product can
 * raise by scanning for `new AppError("LITERAL"` in `src/`, and a code that
 * only ever appears as a table VALUE is a code that silently drops out of
 * `doc/ERROR_CODES.md`. That doc is the contract a client switches on —
 * `smtp-errors.ts` keys a fix guide on `MAILBOX_AUTH_FAILED` — so a code the
 * client handles and the docs do not list is exactly the drift the gate exists
 * to catch. Writing the literal here keeps the scan honest.
 *
 * The codes therefore repeat the map's, and `mail-send-classifier.test.js`
 * asserts they still match — reaching each one from a REAL SMTP rejection
 * rather than from this list, so a row that has drifted fails.
 *
 * The ONE deliberate rename is auth: the send path says `MAILBOX_AUTH_FAILED`
 * rather than `SMTP_AUTH_FAILED` because the client has a distinct fix guide
 * for it ("edit this mailbox") and `smtp-errors.ts` already resolves the word
 * "login" to that code. Its 422 is deliberate too — see the row.
 */
const SEND_ERROR_WORDING = {
  SENDER_NOT_AUTHORIZED: (addr, raw, mapped) => new AppError(
    "SENDER_NOT_AUTHORIZED",
    `Your mailbox ${addr} isn't an authorised sender on its own mail server, so the server refused the message`
      + (raw ? ` (${raw})` : "")
      + `. This is the mailbox's SMTP setup — not Praxis. The "From" address must be a real mailbox on that server and usually has to match the login you connected with. Open Comms → Mailbox → Edit on this mailbox to fix the address, login or password, then Test.`,
    mapped.status,
    mapped.details,
  ),

  SMTP_AUTH_FAILED: (addr, raw, mapped) => new AppError(
    "MAILBOX_AUTH_FAILED",
    `Login to ${addr} was rejected by its mail server${raw ? ` (${raw})` : ""}. Edit this mailbox to correct the username or password, then Test.`,
    // The one status override. The shared map calls a rejected credential a 502
    // because for Test and the platform probe it IS "the remote server said
    // no", and `smtp-error-map.test.js` pins that. On a person's OWN mailbox it
    // is a configuration fact about a screen they can open, so it stays the 4xx
    // it has always been here — otherwise every mistyped password lands in the
    // server-error monitor as a Praxis fault.
    422,
    mapped.details,
  ),

  RECIPIENT_REJECTED: (addr, raw, mapped) => new AppError(
    "RECIPIENT_REJECTED",
    `${addr}'s mail server refused a recipient${raw ? ` (${raw})` : ""}. Check the To/Cc addresses.`,
    mapped.status,
    mapped.details,
  ),

  SMTP_SEND_REJECTED: (addr, raw, mapped) => new AppError(
    "SMTP_SEND_REJECTED",
    `${addr}'s mail server rejected the message outright${raw ? `: ${raw}` : ""}. It will not be retried — a 5xx refusal means the server has decided. Usually the message is too large, or the recipient's mailbox is full.`,
    mapped.status,
    mapped.details,
  ),

  SMTP_SEND_FAILED: (addr, raw, mapped) => new AppError(
    "SMTP_SEND_FAILED",
    `${addr}'s mail server could not take the message just now${raw ? `: ${raw}` : ""}. This is usually temporary, and it will be tried again.`,
    mapped.status,
    mapped.details,
  ),
};

/**
 * Translate a raw SMTP/provider send failure into a message that puts the blame
 * where it belongs — the connected mailbox's OWN server/config, not Praxis.
 *
 * ── IT PRESERVES THE CLASSIFIER'S VERDICT, AND THAT IS THE POINT ────────────
 *
 * `mapSmtpError` sorts a rejection into five outcomes: auth, sender, recipient,
 * TRANSIENT (421/451/452, greylisting, "try again later"), and a hard 5xx
 * refusal. The last two are the same HTTP status — both 502, because from the
 * API's point of view both are "the remote server did not take it" — and they
 * are opposite operational facts: one should be retried and the other must not
 * be.
 *
 * This function used to flatten both into one `MAIL_SEND_FAILED`, so
 * `outbox.retryPlan` — which decides retries from the code — could not tell
 * them apart and retried both. A message the recipient's server refused for
 * being too large was sent again at 30s, 2min and 8min, against a server that
 * had already said no three times in RFC-defined language, before the person
 * who could have shortened it or sent a secure link instead was told anything.
 * Which is exactly what `retryPlan`'s own header says it exists to prevent:
 * "trying a rejected sender address three times does not make it work; it just
 * delays telling the person something only they can fix, and burns three more
 * entries in the mail host's abuse log."
 *
 * It also made two of the client's fix guides — `SMTP_SEND_REJECTED` and
 * `SMTP_SEND_FAILED` in `smtp-errors.ts` — unreachable from a send, because no
 * send ever produced those codes.
 *
 * So: the verdict survives, the wording is overlaid, and `MAIL_SEND_FAILED` is
 * now only what it says on the tin — a send that failed for a reason the SMTP
 * classifier could not name at all.
 */
function explainSendError(err, conn) {
  const raw = String((err && (err.response || err.message)) || "").trim();
  const addr = (conn && conn.email_address) || "this mailbox";
  const mapped = mapSmtpError(err);

  /* An AppError that arrives here is already a verdict somebody made — the
   * archived-mailbox refusal from `outbox.assertRoomFor`, a NOT_FOUND on a
   * connection that vanished mid-queue. `mapSmtpError` hands one straight back,
   * and so must this: rewrapping it below would keep its status and REPLACE its
   * code with MAIL_SEND_FAILED, which is how `MAILBOX_ARCHIVED` would stop
   * being the thing `retryPlan` and the outbox screen recognise. Nothing throws
   * one down this path today; the guard is here so that staying true is not a
   * property of every future caller remembering. */
  if (mapped === err) return err;

  const wording = SEND_ERROR_WORDING[mapped.code];
  if (wording) return wording(addr, raw, mapped);

  /* Unreachable today, and deliberately kept.
   *
   * `mapSmtpError` is TOTAL — every error it is given comes back as one of its
   * five verdicts, and all five have wording above. So this branch can only be
   * reached by a SIXTH verdict added to the map without wording added here, and
   * the honest thing to do about that message is send it with the server's own
   * words rather than crash on an undefined lookup.
   *
   * `mail-send-classifier.test.js` fails the moment such a verdict exists, so
   * this is a soft landing rather than the silent hole it used to be: before,
   * it swallowed two of the five and cost the outbox its retry decision. */
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

  // NEVER LET A USER'S MESSAGE BE SWALLOWED IN SILENCE.
  //
  // This is the path the incident actually travelled: a compose from a connected
  // IMAP/SMTP mailbox, relayed through a shared host that also hosted the
  // recipient's domain. The relay answered 250, filed the message into a local
  // mailbox on itself, and generated no bounce — so the product recorded a
  // successful send for a message nobody would ever receive.
  //
  // Only SMTP can be trapped this way. Graph and Gmail hand the message to the
  // provider's own API, which routes it; there is no relay in between to get
  // the destination wrong, so they are not checked.
  //
  // Placed in prepareSend because `send()` and `reply()` both come through here,
  // and a guard that covers one of two send paths is not a guard. It runs before
  // the allowance is spent and before anything is handed to the adapter.
  if (conn.provider === "imap_smtp" && conn.smtp_host && to) {
    try {
      await routeCheck.assertRoutable({ smtpHost: conn.smtp_host, to });
    } catch (err) {
      if (err && err.code === "MAIL_ROUTE_TRAPPED") {
        throw new AppError("MAIL_ROUTE_TRAPPED", err.message, 422, err.details || null);
      }
      /* @silent:parse the checker could not answer; sending as before is the
         defined fallback, and a broken guard must never block a real send */
    }
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
    // §9.6 archives "every message, in and out". Outbound is the half that
    // matters most to an auditor asking what we told a client and when, so it
    // is archived at the moment of record and, like ingest, is allowed to fail
    // the operation rather than leave a hole in the chain.
    await triageHooks.onMessageSent(client, { ...row, thread_id: thread.email_thread_id });
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
// state `purpose` tag, the path its consent redirect MUST come back to, and a
// probe adapter to resolve the mailbox address.
const OAUTH = {
  microsoft_graph: {
    idp: msOAuth, purpose: "ms_oauth", callbackPath: "/oauth/microsoft/callback",
    probe: (tok) => new MicrosoftGraphProvider({ getAccessToken: async () => tok }),
  },
  google_gmail: {
    idp: googleOAuth, purpose: "gg_oauth", callbackPath: "/oauth/google/callback",
    probe: (tok) => new GmailProvider({ getAccessToken: async () => tok }),
  },
};

/**
 * Refuse a redirect URI that does not point at the callback — BEFORE anybody is
 * sent to the provider.
 *
 * ── THE FAILURE THIS REPLACES ───────────────────────────────────────────────
 *
 * A deployment had its Microsoft redirect URI configured as the `/start`
 * endpoint rather than `/callback`. Everything about that looks fine right up
 * until it is far too late: consent is requested normally, the provider's
 * sign-in page renders, the operator types their password and approves — and
 * only THEN does the provider redirect the browser to the address it was
 * given. `/start` sits behind `authMiddleware` (a consent flow is a write, so
 * it must), and a provider redirect is a bare browser GET carrying no session,
 * so what the operator got for their password was a raw JSON body:
 *
 *   {"error":{"code":"AUTH_REQUIRED","message":"Authorization header missing"}}
 *
 * That names nothing they can act on. It does not say which URL was wrong, or
 * that a URL was wrong at all, and it arrives on a screen belonging to neither
 * this product nor Microsoft. `/callback` is mounted ABOVE `authMiddleware`
 * precisely so it can receive that redirect — the misconfiguration was simply
 * pointing at the one endpoint that structurally cannot serve it.
 *
 * ── WHY IT IS CHECKED HERE ──────────────────────────────────────────────────
 *
 * This is the last moment we hold the value and the first moment we know which
 * provider it is for, and it is before the redirect — so the operator is told
 * in the connect dialog, having typed nothing and consented to nothing, rather
 * than after handing their credentials to a flow that could never complete.
 * The check cannot fix the OTHER half (the provider's own app registration has
 * to carry the same URI), but a deployment whose stored value is right and
 * whose registration is wrong fails at the provider with its own named error
 * — AADSTS50011 — which at least says what it is.
 *
 * A DERIVED redirect URI always ends in the callback path, so this only ever
 * fires on a value somebody configured by hand.
 */
function assertRedirectUriIsCallback(provider, redirectUri, callbackPath) {
  let pathname;
  try {
    ({ pathname } = new URL(String(redirectUri)));
  } catch {
    /* @silent:parse an unparseable URI is reported below as the
       misconfiguration it is, with the offending value named */
    pathname = null;
  }
  if (pathname && pathname.replace(/\/+$/, "").endsWith(callbackPath)) return;
  throw new AppError(
    "OAUTH_REDIRECT_MISCONFIGURED",
    `The sign-in return address configured for ${provider} is "${redirectUri}", which does not end in `
      + `"${callbackPath}". A provider sends people back to that address AFTER they have signed in, and `
      + "only the callback endpoint can receive them — every other route requires a session the return "
      + "visit does not carry, so the sign-in would fail at the last step with an authorisation error. "
      + "Correct it in Platform Console → Integrations (or the deployment's redirect-URI environment "
      + "variable, which is used when that field is blank), and register the SAME address with the "
      + "provider. Leaving both blank is also valid — the address is then derived correctly on its own.",
    500,
    { provider, redirect_uri: String(redirectUri), expected_suffix: callbackPath },
  );
}

/**
 * Step 1: return the provider consent URL. State is a signed JWT binding the
 * provider + tenant slug + initiating user + redirect (CSRF + tenant pinning).
 *
 * ── AND WHAT KIND OF MAILBOX IS BEING CONNECTED ─────────────────────────────
 *
 * `kind`, `catalogue_key` and `department` ride in the state for the same
 * reason the tenant slug does: the callback arrives as a bare browser redirect
 * from Microsoft, with no session, no body and no way to ask the operator
 * anything. Whatever `completeOAuth` needs to classify the mailbox it has to
 * have been TOLD before the redirect, and the state is the only channel that
 * survives the round trip — signed, so a consent begun for `operations@` cannot
 * be replayed into somebody's personal mailbox by editing a query string.
 */
async function startOAuth(client, provider, {
  slug, redirectUri, display_name = null, actor = {},
  kind: rawKind = null, catalogue_key = null, department = null,
}) {
  const o = OAUTH[provider];
  if (!o) throw new AppError("PROVIDER_UNSUPPORTED", `Unknown OAuth provider '${provider}'`, 400);
  // P4: "kept and tested but gated off — SERVER-SIDE, not only in the UI." The
  // gate used to sit on `connect()` alone, which the OAuth path does not go
  // through: it inserts its connection directly in `completeOAuth`. So hiding
  // the two buttons was in fact the only thing standing between a caller and a
  // half-supported provider, and a POST from a console or a stale tab walked
  // straight past it. Asked HERE as well so a disabled provider is refused
  // before anyone is redirected to Microsoft, rather than after they have
  // consented and come back.
  await assertProviderEnabled(client, provider);
  // Microsoft resolves these from the platform vault, so they are async now.
  // `await` on the still-synchronous Google adapter is a no-op, so one call
  // shape keeps serving both.
  if (!(await o.idp.isConfigured())) throw new AppError("NOT_CONFIGURED", `${provider} OAuth is not configured`, 400);
  if (!slug || !redirectUri) throw new AppError("VALIDATION_ERROR", "slug and redirectUri are required", 422);
  // Before the consent URL is built, so a misconfigured return address is a
  // sentence in the connect dialog rather than a raw 401 the operator meets
  // after they have already typed their password at the provider.
  assertRedirectUriIsCallback(provider, redirectUri, o.callbackPath);
  const kind = rawKind === "SHARED" ? "SHARED" : "PERSONAL";
  // NOT the place to refuse a second personal mailbox, however tempting it is
  // to fail before the redirect: which mailbox this is, is not known until
  // Microsoft says so. Re-running consent is also the ONLY way to reconnect an
  // OAuth mailbox whose tokens have gone stale — there is no password to
  // re-enter — so a guard here would lock a person out of repairing the very
  // mailbox they already own. `completeOAuth` asks once the address is known,
  // where it can tell "a second mailbox" apart from "the same one again".
  const state = jwt.sign(
    {
      purpose: o.purpose, provider, slug, user_id: actor.user_id || null,
      display_name, redirectUri,
      kind,
      catalogue_key: kind === "SHARED" ? catalogue_key || null : null,
      department: kind === "SHARED" ? department || null : null,
    },
    config.JWT_ACCESS_SECRET, { expiresIn: OAUTH_STATE_TTL },
  );
  return { url: await o.idp.authorizeUrl({ state, redirectUri }) };
}

/**
 * What kind of mailbox a consent flow was for, read back WITHOUT throwing.
 *
 * Only ever used to decide which tab the browser lands on after the redirect,
 * including the failure path, where the whole point is that something already
 * went wrong and a second exception would replace a useful error message with a
 * useless one. It verifies the signature — an unverified `jwt.decode` would let
 * a crafted state steer the redirect — and answers `null` for anything it
 * cannot read. Nothing is authorised on the strength of it.
 */
function readOAuthStateKind(state) {
  try {
    const claims = jwt.verify(state, config.JWT_ACCESS_SECRET);
    return claims && claims.kind === "SHARED" ? "SHARED" : "PERSONAL";
  } catch {
    /* @silent:parse an unreadable or expired state has a defined fallback —
       no hint — and the caller only wants one to choose a tab with */
    return null;
  }
}

/** Step 2: exchange the code, resolve the mailbox, upsert the connection, store
 *  the token bundle in the vault. Runs on the tenant DB resolved from the host. */
async function completeOAuth(client, provider, { code, state, slug, webhookUrl }) {
  const o = OAUTH[provider];
  if (!o) throw new AppError("PROVIDER_UNSUPPORTED", `Unknown OAuth provider '${provider}'`, 400);
  // Again here, and not redundantly: this is the function that WRITES the
  // connection row, and an OAuth state token is valid for its whole TTL — so a
  // consent flow begun while the provider was enabled would otherwise land a
  // mailbox after an administrator turned it off.
  await assertProviderEnabled(client, provider);
  let claims;
  try { claims = jwt.verify(state, config.JWT_ACCESS_SECRET); } catch { throw new AppError("BAD_STATE", "invalid or expired OAuth state", 400); }
  if (claims.purpose !== o.purpose || claims.provider !== provider) throw new AppError("BAD_STATE", "wrong state purpose/provider", 400);
  if (slug && claims.slug && slug !== claims.slug) throw new AppError("TENANT_MISMATCH", "OAuth state is for a different tenant", 400);

  const tokens = await o.idp.exchangeCode({ code, redirectUri: claims.redirectUri });
  const expires_at = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;

  const who = await o.probe(tokens.access_token).verify();
  if (!who.ok || !who.email) throw new AppError("OAUTH_PROBE_FAILED", who.error || "could not read mailbox", 502);

  // A SHARED mailbox is a team address, not the consenting person's own — so it
  // is born SHARED, ownerless, and the operator gets it as a MANAGER grant
  // rather than as `owner_user_id`.
  const kind = claims.kind === "SHARED" ? "SHARED" : "PERSONAL";
  const ownerUserId = kind === "SHARED" ? null : claims.user_id || null;

  let conn = await repo.findByAddress(client, who.email, provider);
  const isNew = !conn;
  // Now that the address is known, the one-personal-mailbox rule can be applied
  // the way it is meant to be: a NEW second mailbox is refused with a sentence
  // naming the one already held, while re-consenting to a mailbox the person
  // already owns — the only way to refresh a stale OAuth token — goes through.
  // Without this the 23505 from `ux_email_connection_one_personal` reaches the
  // browser as the error handler's generic "A record with these values already
  // exists", on the far side of a redirect, naming nothing.
  if (isNew && kind === "PERSONAL" && claims.user_id) {
    await mailbox.assertNoPersonalMailbox(client, claims.user_id);
  }
  if (!conn) {
    conn = await repo.insertConnection(client, {
      email_address: who.email, provider, display_name: claims.display_name || null,
      owner_user_id: ownerUserId,
      // Stamped on the INSERT, not by `classify` a statement later. 10723 gives
      // `kind` a DEFAULT of 'PERSONAL' and a partial unique index over it —
      // UNIQUE (owner_user_id) WHERE kind = 'PERSONAL' AND status <> 'ARCHIVED'
      // — so a row that arrives without its kind is momentarily a SECOND
      // personal mailbox for whoever created it, and the index refuses it with
      // a 23505 the error handler renders as "A record with these values
      // already exists". That is the exact defect 82d02ec fixed on the password
      // path (tests/unit/mail-shared-mailbox-kind.test.js); this path inserts
      // its own row and never went through `connect()`, so it still had it.
      kind,
      status: "CONNECTED", token_expires_at: new Date(expires_at),
    });
  } else {
    await repo.updateConnection(client, conn.email_connection_id, { status: "CONNECTED", last_error: null, token_expires_at: new Date(expires_at) });
    // Never onto a team address: `owner_user_id` on a SHARED mailbox is what
    // "this is one person's mailbox" means, and claiming operations@ for
    // whoever happened to reconnect it is how a team address quietly becomes
    // somebody's personal one.
    if (kind !== "SHARED") await repo.claimConnectionIfUnowned(client, conn.email_connection_id, claims.user_id);
  }

  const secret_key = secretKeyFor(conn.email_connection_id);
  await settings.put(client, {
    section: settings.SECRET_SECTION, key: secret_key,
    value: { provider, key_name: "MAIL_CONN", secret: JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at }) },
    actor: { user_id: claims.user_id || null },
  });
  await repo.updateConnection(client, conn.email_connection_id, { secret_key });
  // Stamp WHAT this mailbox is — the team slot it fills, its department, its
  // visibility, and (for a shared one) the MANAGER grant that lets the person
  // who just set it up add anybody else to it. `connect()` does exactly this
  // for the password path; the OAuth path wrote a transport row and stopped,
  // which is why a mailbox connected here never appeared against its catalogue
  // slot and had no members at all.
  //
  // ON THE INSERT ONLY. A mailbox that already exists has already been
  // classified, and re-stamping it here would let a RECONNECT rewrite what the
  // mailbox IS: a personal mailbox reconnected through the shared chooser would
  // silently become a team address (exposing one person's correspondence to
  // whoever holds the slot), and a team address reconnected through the
  // personal one would lose its catalogue slot and department. Converting a
  // personal mailbox into a shared one is a deliberate, audited action —
  // `mailbox.handover` — and must not be reachable by picking the other button.
  if (isNew) {
    await mailbox.classify(client, conn.email_connection_id, {
      kind,
      catalogueKey: kind === "SHARED" ? claims.catalogue_key || null : null,
      department: kind === "SHARED" ? claims.department || null : null,
      actor: { user_id: claims.user_id || null },
    });
  }
  // "Which mailbox do I send from by default" is a question about a person's
  // own mailboxes. A team address is not one of them.
  if (kind !== "SHARED") await repo.ensureDefaultConnection(client, claims.user_id);
  await setupPush(client, conn.email_connection_id, provider, { webhookUrl }).catch(() => { /* @silent:storage push optional; polling covers it */ });
  return { email_connection_id: conn.email_connection_id, email_address: who.email, provider, status: "CONNECTED", kind };
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
async function autoLink(client, args) {
  try {
    const binding = require("../binding/binding.service");
    await binding.suggestOnIngest(client, args);
  } catch { /* @silent:teardown — a failed suggestion never aborts the sync loop */ }
}

/**
 * Legacy flat message list, kept for the AI catalogue and the 360 timeline.
 *
 * `actor` is the third argument because that is what both AI adapters pass
 * (see action-registrar). It is the fallback for `q.user_id`, so this read is
 * scoped to the caller whether it arrives over HTTP or through the copilot —
 * `listThreads` applies both the mailbox-access and the visibility predicate,
 * and a null user id matches no mailbox, which is the fail-closed direction.
 */
const listThread = (client, q = {}, actor = null) =>
  threadRepo.listThreads(client, q.user_id || (actor && actor.user_id) || null, {
    connectionId: q.connection_id, limit: q.limit, before: q.before,
  });
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
/**
 * Mail timeline for a client (Phase 3 CRM). Accepts a client id or an entity_ref.
 *
 * Scoped to the caller for the same reason as `listThread`: this is the read
 * that puts correspondence on a screen OUTSIDE the mailbox, which makes it the
 * easiest place in the product to be shown a thread you were never meant to see
 * (§9.10 criterion 7 names the client timeline explicitly). `actor` is the AI
 * adapter's third argument; `args.user_id` is the HTTP caller's.
 */
const clientTimeline = (client, { client_id, entity_ref, limit, user_id } = {}, actor = null) =>
  threadRepo.timelineByEntity(client, entity_ref || `client:${client_id}`, {
    limit, userId: user_id || (actor && actor.user_id) || null,
  });

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
  clientTimeline, linkEntity, autodiscover, searchRecipients, allowedRecipientSources,
  listConnectMethods, readOAuthStateKind,
  startMicrosoftOAuth, completeMicrosoftOAuth, handleGraphNotification,
  startGoogleOAuth, completeGoogleOAuth, handleGmailNotification, renewSubscriptions,
  // Exported for the send-queue flusher, which injects them rather than
  // importing this module — outbox.service must stay loadable, and testable,
  // without dragging in every provider adapter.
  resolveAdapter, recordOutbound, explainSendError,
};
