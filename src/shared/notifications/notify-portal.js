/**
 * Client portal notifications — the producer half (14180).
 *
 * `emitEvent` hands every event to `onEvent`. The handful that mean "something
 * is waiting for a client in their portal" become a row in
 * `portal_notify_outbox` and a delayed `portal-notify-deliver` job; for every
 * other event this is one object lookup and a return.
 *
 * ── WHY A ROW, AND NOT ONLY A JOB ───────────────────────────────────────────
 *
 * The row is written in the transaction of the change it is about, so a change
 * that rolls back takes its notification with it — a client is never told
 * about a reply that was never saved. And the job reads EVERY waiting row for
 * the client and topic, so a burst is one message: four documents requested in
 * a minute are one email listing four things.
 *
 * ── WHY THE JOBS ARE BUCKETED ───────────────────────────────────────────────
 *
 * One job per client, topic (and conversation) per time window: its id carries
 * the window, so the second event of a burst finds the job already queued and
 * adds nothing, and the job runs only after its window has closed — by then no
 * event can still join it, and anything later belongs to the next window's job.
 * A chat reply is pushed after 12–22 seconds, long enough for a client who is
 * looking at that conversation to have read it (the open conversation
 * refreshes every ten), in which case nothing is sent. It is emailed after
 * 10–20 minutes, and only if still unread then. Everything else goes out on
 * both channels after about a minute.
 *
 * ── ONLY REAL CLIENTS ───────────────────────────────────────────────────────
 *
 * Nothing here runs against a sandbox connection: it has no clients to tell,
 * and a sandbox must never reach a real one (PRD §5.5). Nothing runs without a
 * tenant in the request context either (a migration, a script, a unit test),
 * because there would be no tenant to queue the job for.
 *
 * Best-effort throughout: a notification that cannot be queued must never fail
 * the business operation that emitted the event.
 */
"use strict";

const { logger } = require("../../config/logger");
const requestContext = require("../../config/request-context");

const CONN_ENV = Symbol.for("praxis.conn.env");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "invoice:<uuid>" → the uuid, or null. */
function idOf(ref) {
  const s = String(ref || "");
  const id = s.slice(s.indexOf(":") + 1);
  return UUID.test(id) ? id : null;
}

/**
 * The events a client hears about, and how each is read.
 *
 *   topic   which of the client's five switches governs it
 *   when    the payload says it is the kind worth telling (a STAFF reply, not
 *           the client's own message; a stage DONE, not merely started)
 *   item    the thing the notification is about, as `<type>:<id>`
 *   client  where the client id comes from when the payload does not carry it
 *   thread  the conversation, for MESSAGES
 */
const EVENTS = {
  "portal.client_message": {
    topic: "MESSAGES",
    when: (p) => p.direction === "STAFF",
    thread: (p) => (p.dossier_id && UUID.test(p.dossier_id) ? p.dossier_id : "general"),
  },
  "client_request.created": { topic: "REQUESTS" },
  // A rejection is a request again: the client has something to send.
  "client_request.reviewed": { topic: "REQUESTS", when: (p) => p.status === "REJECTED" },
  "invoice.posted": { topic: "BILLING", client: "invoice" },
  "invoice_bundle.published": { topic: "BILLING" },
  "payment_proof.confirmed": { topic: "BILLING" },
  "payment_proof.rejected": { topic: "BILLING" },
  "proposal.sent": { topic: "PROPOSALS", client: "proposal" },
  "milestone.advanced": {
    topic: "SHIPMENTS",
    when: (p) => p.to === "DONE" && UUID.test(String(p.milestone_instance_id || "")),
    item: (_ref, p) => `milestone_instance:${p.milestone_instance_id}`,
    client: "milestone",
  },
};

/** When the client is not in the payload: read it, and read only what the client may see. */
const CLIENT_OF = {
  invoice: [
    "SELECT client_id FROM invoice WHERE invoice_id = $1 AND type = 'FINAL'",
    (ref) => idOf(ref),
  ],
  proposal: ["SELECT client_id FROM proposal WHERE proposal_id = $1", (ref) => idOf(ref)],
  // Only a stage the client can see, on a file that is not a draft — the
  // rest of the chain is the team's, and a draft is not a file yet.
  milestone: [
    `SELECT d.client_id
       FROM milestone_instance mi
       JOIN dossier_visible d ON d.dossier_id = mi.dossier_id
      WHERE mi.milestone_instance_id = $1 AND mi.is_client_visible`,
    (_ref, p) => p.milestone_instance_id,
  ],
};

/**
 * Run `fn` so that its failure cannot poison the caller's transaction.
 *
 * This runs inside the business operation's transaction, and in Postgres a
 * failed statement aborts the WHOLE transaction even when JavaScript catches
 * the error: every later statement answers "current transaction is aborted",
 * and the invoice that was being posted fails for a notification's sake. A
 * savepoint confines the failure to this block. Outside a transaction the
 * SAVEPOINT itself is refused (25P01) — harmlessly, nothing is open — and the
 * statement simply runs on its own.
 */
async function guarded(client, fn) {
  let savepoint = true;
  try {
    await client.query("SAVEPOINT portal_notify");
  } catch {
    /* @silent:storage — no transaction is open, so there is nothing to protect */
    savepoint = false;
  }
  try {
    const out = await fn();
    if (savepoint) await client.query("RELEASE SAVEPOINT portal_notify");
    return out;
  } catch (err) {
    if (savepoint) {
      await client.query("ROLLBACK TO SAVEPOINT portal_notify").catch(() => {
        /* @silent:teardown — the original error is the one worth reporting */
      });
    }
    throw err;
  }
}

/** What an event is about, for whom — or null when it is not for a client. */
async function target(client, spec, { eventTypeKey, entityRef, payload }) {
  const item = spec.item ? spec.item(entityRef, payload) : entityRef;
  if (!item || !idOf(item)) return null;
  let clientId = payload.client_id && UUID.test(String(payload.client_id)) ? String(payload.client_id) : null;
  if (!clientId && spec.client) {
    const [sql, arg] = CLIENT_OF[spec.client];
    const key = arg(entityRef, payload);
    if (!key) return null;
    const { rows } = await client.query(sql, [key]);
    clientId = (rows[0] && rows[0].client_id) || null;
  }
  if (!clientId) return null;
  return {
    clientId,
    topic: spec.topic,
    thread: spec.thread ? spec.thread(payload) : null,
    eventKey: eventTypeKey,
    item,
  };
}

/**
 * The jobs one outbox row needs: a chat reply is pushed quickly and emailed
 * slowly (and only if still unread); everything else goes out on both
 * channels in one pass.
 */
function plan(topic) {
  return topic === "MESSAGES"
    ? [
        { stage: "push", windowMs: 20_000, minDelayMs: 12_000 },
        { stage: "email", windowMs: 10 * 60_000, minDelayMs: 10 * 60_000 },
      ]
    : [{ stage: "both", windowMs: 60_000, minDelayMs: 30_000 }];
}

/**
 * Queue the delivery of whatever is waiting for this client and topic.
 * Exported for the job itself, which re-queues anything an earlier job missed.
 */
async function schedule(tenantMeta, { clientId, topic, thread = null }, now = Date.now()) {
  const { enqueue } = require("../../jobs/queue-producer");
  for (const { stage, windowMs, minDelayMs } of plan(topic)) {
    const bucket = Math.floor(now / windowMs);
    const runAt = Math.max((bucket + 1) * windowMs, now + minDelayMs);
    await enqueue(
      "portal-notify-deliver",
      stage,
      { tenantMeta, env: "live", clientId, topic, thread, stage },
      {
        // One job per client, topic, conversation, stage and window — see the
        // header. `-` separators, not `:`, which Redis keys already use.
        jobId: ["portalnotify", tenantMeta.slug, clientId, topic, thread || "none", stage, bucket].join("-"),
        delay: runAt - now,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}

/** Resolved once a minute per tenant: the job needs the registry row to connect. */
const META_TTL_MS = 60_000;
const metaCache = new Map();
async function tenantMetaFor(slug) {
  const hit = metaCache.get(slug);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const registry = require("../../services/tenant/registry.service");
  const meta = await registry.resolveBySlug(slug);
  metaCache.set(slug, { meta, at: Date.now() });
  if (metaCache.size > 500) metaCache.delete(metaCache.keys().next().value);
  return meta;
}

/**
 * Record one event for a client, if it is one they hear about, and queue its
 * delivery. Returns what was recorded, or null.
 */
async function onEvent(client, { eventTypeKey, entityRef = null, payload = {} }) {
  const spec = EVENTS[eventTypeKey];
  if (!spec) return null;
  const p = payload || {};
  if (spec.when && !spec.when(p)) return null;
  const env = (client && client[CONN_ENV]) || requestContext.getEnv() || "live";
  if (env === "sandbox") return null;
  const slug = requestContext.getTenant();
  if (!slug) return null;

  let row;
  try {
    row = await guarded(client, async () => {
      const t = await target(client, spec, { eventTypeKey, entityRef, payload: p });
      if (!t) return null;
      await client.query(
        `INSERT INTO portal_notify_outbox (client_id, topic, thread_key, event_key, item_ref)
         VALUES ($1, $2, $3, $4, $5)`,
        [t.clientId, t.topic, t.thread, t.eventKey, t.item],
      );
      return t;
    });
  } catch (err) {
    logger.warn({ err, eventTypeKey }, "[notify-portal] could not record a client notification");
    return null;
  }
  if (!row) return null;

  try {
    const meta = await tenantMetaFor(slug);
    if (meta) await schedule(meta, row);
  } catch (err) {
    // The row is saved; the next job for this client and topic — or any job
    // in this tenant, which sweeps what is left waiting — delivers it.
    logger.warn({ err, eventTypeKey }, "[notify-portal] delivery not queued; the row waits for the next job");
  }
  return row;
}

module.exports = { onEvent, schedule, plan, EVENTS, idOf };
