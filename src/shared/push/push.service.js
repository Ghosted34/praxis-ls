/**
 * Web-Push sender (imported by notifications.service). VAPID identity is
 * DEPLOY-WIDE: resolved from platform_setting 'push'/'vapid' (generated + stored
 * in the Platform Console, private key encrypted) → env VAPID_* fallback.
 *
 * The delivery pipeline is complete end to end: the Settings opt-in
 * (`client/src/components/pwa/push-opt-in.tsx`) subscribes the browser with the
 * public VAPID key and POSTs to /notifications/push/subscribe, which writes the
 * tenant `push_subscription` table; sendToUser reads that table and pushes via
 * `web-push` (lazily required); the Workbox service worker imports
 * `client/public/push-handler.js` to display the notification. Where any piece
 * is absent (no keypair, table not provisioned), sendToUser degrades cleanly
 * ({ sent: 0, reason }) rather than throwing into the notification path.
 *
 * ── WHY THE RESULT IS DETAILED AND NOT JUST A COUNT ─────────────────────────
 *
 * The caller has to be able to tell "this user has no device registered" apart
 * from "this user has three devices and all three sends failed" apart from
 * "push is not configured on this deployment". They are three different
 * situations and only the middle one is worth retrying; the first two are worth
 * falling back to email over. So sendToUser reports `{ sent, failed, total,
 * pruned, reason }` and the delivery job decides — see
 * jobs/handlers/notification-deliver.js.
 */
"use strict";

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

// NEW-04. This imported `config/database`, whose pool is never initialised, so
// `query` resolved to a function that throws on call. The try/catch guarded the
// REQUIRE, which never failed — the failure was one level deeper, at use.
// Pointing at the pool the process actually creates makes the fallback real.
const { query } = require("../../services/platform/db");

/**
 * How long a push service should hold an undelivered message for a phone that
 * is off or out of coverage, in seconds.
 *
 * The default used to be the library's, which is FOUR WEEKS — so a message
 * about a mail that needed answering this morning could surface on Thursday,
 * out of context and after the thing it was about had been handled. A day is
 * the longest window in which "you have a new mail" is still news; past that
 * the in-app inbox is the honest surface for it.
 */
const DEFAULT_TTL_S = 86_400;

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
    /* @silent:storage — the platform store is unreachable; the env fallback
       below is the defined degradation, and the caller never needs to know
       which source supplied the keypair. */
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
 * The JSON the service worker receives. Kept in one place because
 * `client/public/push-handler.js` reads exactly these keys and the two files
 * cannot be changed independently without a silent regression — a payload key
 * the handler does not know is not an error anywhere, it is just a notification
 * that quietly loses its deep link or its icon.
 *
 * A note on `tag`, which is the field that matters most here. A tag tells the
 * OS "this notification REPLACES any existing one with the same tag". The old
 * code sent `tag: userId`, so every notification a user received replaced the
 * previous one: five urgent mails arrived and the phone showed one, with the
 * other four destroyed by the OS before anybody read them. The default is now
 * undefined — notifications stack — and a caller that genuinely wants
 * collapsing (all activity on one mail thread, say) passes a tag deliberately,
 * with `renotify` so the replacement still alerts rather than swapping in
 * silently.
 */
function buildPayload({
  title,
  body = "",
  url = "/notifications",
  tag = undefined,
  renotify = false,
  requireInteraction = false,
  badgeCount = null,
  actions = null,
  data = null,
  timestamp = null,
}) {
  return JSON.stringify({
    title,
    body,
    url,
    tag,
    renotify: Boolean(renotify),
    requireInteraction: Boolean(requireInteraction),
    badgeCount: Number.isFinite(badgeCount) ? badgeCount : null,
    actions: Array.isArray(actions) && actions.length ? actions.slice(0, 2) : null,
    data: data || null,
    timestamp: timestamp || Date.now(),
  });
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
 *
 * `urgency` maps onto the Web Push protocol header of the same name, and it is
 * not decoration: at "normal" (the library default) FCM and APNs are entitled
 * to hold a message until the device next wakes on its own, which on a dozing
 * Android phone is measured in tens of minutes. "high" is what makes a mail
 * alert arrive when the mail does. It costs battery, so it belongs to the
 * categories that earn it — comms and security — not to every posted invoice.
 */
async function sendToUser(a, b) {
  const hasClient = b !== undefined;
  const opts = hasClient ? b : a;
  const {
    user_id, title, body, url, tag,
    renotify, requireInteraction, badgeCount, actions, data, timestamp,
    urgency = "normal", ttl = DEFAULT_TTL_S,
  } = opts || {};
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
  if (!webpush || !q) return { sent: 0, failed: 0, total: 0, pruned: 0, reason: "push not configured" };
  let subs;
  try {
    const res = await q(`SELECT endpoint, p256dh, auth FROM ${table} WHERE user_id = $1`, [user_id]);
    subs = res.rows;
  } catch {
    // subscription table not provisioned yet
    return { sent: 0, failed: 0, total: 0, pruned: 0, reason: "no push_subscription table" };
  }
  if (!subs.length) return { sent: 0, failed: 0, total: 0, pruned: 0, reason: "no registered devices" };

  const payload = buildPayload({
    title, body, url, tag, renotify, requireInteraction, badgeCount, actions, data, timestamp,
  });
  const sendOptions = {
    TTL: Number.isFinite(ttl) ? ttl : DEFAULT_TTL_S,
    urgency: urgency === "high" || urgency === "low" || urgency === "very-low" ? urgency : "normal",
  };

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  for (const s of subs) {
    try {
       
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        sendOptions,
      );
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // expired/gone subscription — prune it. NOT counted as a failure: the
        // device is deliberately unregistered, and a caller that treats it as a
        // failure would retry a send that can never succeed.
         
        await q(`DELETE FROM ${table} WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
        pruned += 1;
      } else {
        failed += 1;
        logger.warn({ err, statusCode: err.statusCode }, "[push] send failed");
      }
    }
  }
  return { sent, failed, total: subs.length, pruned };
}

module.exports = { sendToUser, getPublicKey, resolveVapid, buildPayload, DEFAULT_TTL_S };
