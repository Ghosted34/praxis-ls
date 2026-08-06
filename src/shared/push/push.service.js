/**
 * Web-Push sender (imported by notifications.service). VAPID identity is
 * DEPLOY-WIDE: resolved from platform_setting 'push'/'vapid' (generated + stored
 * in the Platform Console, private key encrypted) → env VAPID_* fallback.
 *
 * NOTE: the push DELIVERY pipeline is only partially built. This sends to rows in
 * shared.push_subscription, but that table + the client registration flow +
 * service worker are NOT yet implemented — so sendToUser degrades cleanly
 * (returns { sent: 0, reason }) until they exist. `web-push` is lazily required
 * and must be installed (`npm i web-push`).
 */
"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

// NEW-04. This imported `config/database`, whose pool is never initialised, so
// `query` resolved to a function that throws on call. The try/catch guarded the
// REQUIRE, which never failed — the failure was one level deeper, at use.
// Pointing at the pool the process actually creates makes the fallback real.
const { query } = require("../../services/platform/db");

/** Deploy-wide VAPID keypair + subject (platform store first, env fallback). */
async function resolveVapid() {
  let publicKey = null;
  let privateKey = null;
  let subject = null;
  try {
     
    const platformSettings = require("../../services/platform/settings.service");
    const r = await platformSettings.resolve("push", "vapid");
    if (r) {
      publicKey = r.value && r.value.public_key;
      privateKey = r.secret;
      subject = r.value && r.value.subject;
    }
  } catch {
    // platform store unavailable → env fallback
  }
  return {
    publicKey: publicKey || config.VAPID_PUBLIC_KEY || null,
    privateKey: privateKey || config.VAPID_PRIVATE_KEY || null,
    subject: subject || config.VAPID_SUBJECT || "mailto:admin@praxisls.com",
  };
}

/** Public VAPID key for the browser subscribe() call, or null if unset. */
async function getPublicKey() {
  return (await resolveVapid()).publicKey;
}

async function configuredClient() {
  const v = await resolveVapid();
  if (!v.publicKey || !v.privateKey) return null;
   
  const webpush = require("web-push");
  webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey);
  return webpush;
}

/**
 * Push to all of a user's registered subscriptions. Never throws.
 *
 * Two call styles:
 *   sendToUser(tenantClient, { user_id, ... })  → reads the TENANT
 *     `push_subscription` table (where the opt-in endpoint stores them). This is
 *     the path notify() uses.
 *   The legacy no-client style read `shared.push_subscription` via the platform
 *   pool. That schema has never existed (DI-4.2), so the branch was dead; it
 *   and its only caller are gone.
 * Subscriptions that come back gone (404/410) are pruned from whichever table
 * they were read from.
 */
async function sendToUser(a, b) {
  const hasClient = b !== undefined;
  const opts = hasClient ? b : a;
  const { user_id, title, body, url, tag } = opts || {};
  // A tenant client exposes .query(sql, params); the legacy platform `query` is
  // a bare function. Normalise both to q(sql, params).
  const client = hasClient ? a : null;
  const q = client
    ? (sql, params) => client.query(sql, params)
    : query
      ? (sql, params) => query(sql, params)
      : null;
  // DI-4.2: this used to fall back to `shared.push_subscription` via the
  // platform pool. There is no `shared` schema — only live, sandbox and
  // platform — so that branch could only ever return "no push_subscription
  // table". Its sole caller was services/notifications.service.js, which had
  // zero importers and has been deleted. A tenant client is now required.
  const table = "push_subscription";

  const webpush = await configuredClient();
  if (!webpush || !q) return { sent: 0, reason: "push not configured" };
  let subs;
  try {
    const res = await q(`SELECT endpoint, p256dh, auth FROM ${table} WHERE user_id = $1`, [user_id]);
    subs = res.rows;
  } catch {
    // subscription table not provisioned yet
    return { sent: 0, reason: "no push_subscription table" };
  }
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // expired/gone subscription — prune it
        await q(`DELETE FROM ${table} WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
      } else {
        logger.warn({ err }, "[push] send failed");
      }
    }
  }
  return { sent };
}

module.exports = { sendToUser, getPublicKey, resolveVapid };
