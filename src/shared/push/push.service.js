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
 * pruned, stale, reason }` and the delivery job decides — see
 * jobs/handlers/notification-deliver.js.
 *
 * ── THE FOURTH SITUATION, WHICH USED TO BE INVISIBLE (12770) ────────────────
 *
 * A subscription is minted against ONE application server key. Rotating the
 * deploy's VAPID pair — one button in the Platform Console, and the obvious
 * first thing to try when push "isn't working" — makes every subscription in
 * every tenant undeliverable in the same instant.
 *
 * The push services report that with 403 (this signature is not welcome here),
 * NOT with 404/410 (this endpoint is gone). Everything downstream watched for
 * the second, so the first was a permanent outage that nothing could see:
 * rows kept, `/push/devices` still counting them, Settings still promising
 * "You'll get alerts here", the "your device went quiet" email never sent —
 * and the client's boot-time sync re-registering the dead subscription every
 * morning, because it never asked which key it was holding.
 *
 * So subscriptions now carry the fingerprint of the key they were minted with,
 * a superseded one is dropped BEFORE a send is attempted, a 403 drops one that
 * predates the fingerprint, and both are counted in `pruned` — the number
 * every existing "this user is unreachable" mechanism already watches. The
 * device re-subscribes under the current key on its next app boot.
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

/**
 * Deploy-wide VAPID keypair + subject (platform store first, env fallback).
 *
 * `degraded` is the field that matters beyond "which key did we get". The
 * platform lookup is wrapped in a catch, so an unreachable platform database
 * silently yields the ENV key instead — a different key, on a path that looks
 * identical to success. Anything that acts destructively on the identity of the
 * key (see pruneSuperseded) has to know it might be looking at a fallback, or a
 * five-second platform outage would delete every push subscription on the
 * deploy and make the outage it was meant to repair.
 */
async function resolveVapid() {
  let publicKey = null;
  let privateKey = null;
  let subject = null;
  let source = "none";
  let degraded = false;
  try {
     
    const platformSettings = require("../../services/platform/settings.service");
    const r = await platformSettings.resolve("push", "vapid");
    if (r) {
      publicKey = r.value && r.value.public_key;
      privateKey = r.secret;
      subject = r.value && r.value.subject;
      if (publicKey) source = "platform";
    }
  } catch {
    /* @silent:storage — the platform store is unreachable; the env fallback
       below is the defined degradation. The CALLER does need to know it
       happened, which is what `degraded` carries. */
    degraded = true;
  }
  if (!publicKey && config.VAPID_PUBLIC_KEY) source = "env";
  return {
    publicKey: publicKey || config.VAPID_PUBLIC_KEY || null,
    privateKey: privateKey || config.VAPID_PRIVATE_KEY || null,
    subject: subject || config.VAPID_SUBJECT || "mailto:admin@praxisls.com",
    source,
    degraded,
  };
}

/**
 * A subscription's binding to the key it was minted with.
 *
 * A VAPID PUBLIC key is not a secret — it is handed to every browser that
 * subscribes — so hashing it buys no confidentiality. It buys a short, fixed
 * width column and a value that is cheap to compare and safe to print in a
 * diagnostic, which is all this is for.
 */
function keyFingerprint(publicKey) {
  if (!publicKey) return null;
  return require("node:crypto").createHash("sha256").update(String(publicKey)).digest("hex");
}

/** The fingerprint of the key this deployment is currently signing with. */
async function currentKeyFingerprint() {
  return keyFingerprint((await resolveVapid()).publicKey);
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
 * they were read from, and so are ones bound to a VAPID key this deployment no
 * longer signs with — those answer 403, which is just as permanent and used to
 * be invisible (see the header).
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
    const res = await q(`SELECT endpoint, p256dh, auth, vapid_key_hash FROM ${table} WHERE user_id = $1`, [user_id]);
    subs = res.rows;
  } catch {
    // Either the table is not provisioned, or 12770 has not run and
    // `vapid_key_hash` does not exist yet. Both mean "read it the old way, and
    // fall back to reporting the table missing" — a deployment mid-migration
    // must keep delivering.
    try {
      const res = await q(`SELECT endpoint, p256dh, auth FROM ${table} WHERE user_id = $1`, [user_id]);
      subs = res.rows;
    } catch {
      return { sent: 0, failed: 0, total: 0, pruned: 0, reason: "no push_subscription table" };
    }
  }
  if (!subs.length) return { sent: 0, failed: 0, total: 0, pruned: 0, reason: "no registered devices" };

  /*
   * ── SUPERSEDED SUBSCRIPTIONS ────────────────────────────────────────────
   *
   * A subscription is minted against one application server key. Rotate the
   * deploy's VAPID pair and every existing subscription becomes undeliverable
   * at once — and the push services say so with 403 (our signature is not
   * welcome), never 404/410 (the endpoint is gone). Every safety net in this
   * file and its callers was keyed on the second, so the first produced a
   * permanent, silent outage: rows kept, device count non-zero, Settings still
   * reading "You'll get alerts here", lapse email never sent.
   *
   * Comparing the stored fingerprint against the key in force catches it
   * BEFORE the send, and pruning is the repair rather than a loss: the row is
   * genuinely unusable, and the client's boot-time sync re-subscribes under
   * the current key the next time the app is opened. Counting it as `pruned`
   * is deliberate — that is the number every existing "this device went quiet"
   * mechanism already watches.
   *
   * Two guards, because deleting somebody's device on a wrong guess is worse
   * than one more failed send:
   *   - never when the key resolution was DEGRADED (platform store unreachable
   *     → we may be looking at the env fallback, a different key that says
   *     nothing about what the browser subscribed to);
   *   - never for rows with no fingerprint (subscribed before 12770). Those are
   *     attempted, and a 403 below is what marks them.
   */
  const vapid = await resolveVapid();
  const activeHash = keyFingerprint(vapid.publicKey);
  let stale = 0;
  if (activeHash && !vapid.degraded) {
    const superseded = subs.filter((x) => x.vapid_key_hash && x.vapid_key_hash !== activeHash);
    for (const s of superseded) {
       
      await q(`DELETE FROM ${table} WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
      stale += 1;
    }
    if (superseded.length) {
      logger.warn(
        { user_id, superseded: superseded.length },
        "[push] dropped subscriptions minted under a superseded VAPID key — "
        + "the device re-registers on its next app boot",
      );
      subs = subs.filter((x) => !x.vapid_key_hash || x.vapid_key_hash === activeHash);
    }
  }
  if (!subs.length) {
    // Every device this user had belonged to the old key. That is the same
    // FACT as an expired endpoint — this person cannot be reached on a phone
    // right now — so it is reported through the same field, and the lapse
    // notice and email fallback in deliverOutbound light up unchanged.
    return { sent: 0, failed: 0, total: stale, pruned: stale, stale, reason: "devices registered under a superseded key" };
  }

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
      // `last_used_at` has read "last registered" since 0473, because the only
      // things that ever wrote it were subscribe and rotate. It is the one
      // column that could answer "has this device EVER received anything", and
      // it answered a different question. Best-effort, and never in the way of
      // the next device's send.
       
      await q(
        `UPDATE ${table} SET last_used_at = now(), last_error = NULL, last_failed_at = NULL WHERE endpoint = $1`,
        [s.endpoint],
      ).catch(() => {});
    } catch (err) {
      const status = err && err.statusCode;
      if (status === 404 || status === 410) {
        // expired/gone subscription — prune it. NOT counted as a failure: the
        // device is deliberately unregistered, and a caller that treats it as a
        // failure would retry a send that can never succeed.
         
        await q(`DELETE FROM ${table} WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
        pruned += 1;
      } else if (isSupersededKey(err) && !vapid.degraded) {
        // The endpoint is alive and our SIGNATURE is not welcome on it: this
        // subscription belongs to a VAPID key we no longer hold. Rows written
        // before 12770 carry no fingerprint, so this is where they are caught.
        // Same treatment as gone — unusable, pruned, counted in `pruned` so the
        // lapse notice fires — because to the person holding the phone it is
        // the same fact.
         
        await q(`DELETE FROM ${table} WHERE endpoint = $1`, [s.endpoint]).catch(() => {});
        pruned += 1;
        stale += 1;
        logger.warn(
          { user_id, statusCode: status },
          "[push] subscription rejected our VAPID signature — dropped as superseded; "
          + "the device re-registers on its next app boot",
        );
      } else {
        failed += 1;
        logger.warn({ err, statusCode: status }, "[push] send failed");
         
        await q(
          `UPDATE ${table} SET last_failed_at = now(), last_error = $2 WHERE endpoint = $1`,
          [s.endpoint, describeFailure(err)],
        ).catch(() => {});
      }
    }
  }
  return { sent, failed, total: subs.length + stale, pruned, stale };
}

/**
 * Does this rejection mean "your signature is not welcome here" rather than
 * "this endpoint is gone"?
 *
 * The push services are not consistent about it. FCM answers 403 with a body
 * naming the mismatched key; Mozilla's autopush has answered 401 on an
 * unauthorised VAPID assertion; some proxies flatten it to a 400 that only says
 * the word in the body. All three mean the subscription was minted for a key we
 * no longer sign with, and none of them means the device has gone away.
 */
function isSupersededKey(err) {
  const status = err && err.statusCode;
  if (status === 403) return true;
  if (status !== 401 && status !== 400) return false;
  const text = String((err && (err.body || err.message)) || "");
  return /vapid|jwt|signature|authoriz|authoris|unauthorized/i.test(text);
}

/** A short, classified sentence for `push_subscription.last_error`. */
function describeFailure(err) {
  const status = err && err.statusCode;
  const detail = String((err && (err.body || err.message)) || "").slice(0, 200);
  const label = status ? `rejected_${status}` : "unreachable";
  return detail ? `${label}: ${detail}` : label;
}

module.exports = {
  sendToUser, getPublicKey, resolveVapid, buildPayload, DEFAULT_TTL_S,
  keyFingerprint, currentKeyFingerprint, isSupersededKey,
};
