/**
 * SLA clocks, applied (§9.2).
 *
 * `sla-clock.js` knows how to add four business hours to a Friday afternoon.
 * Until this file existed nothing asked it to: `mail_sla_policy`,
 * `business_hours` and `business_holiday` were created by migration 10755 and
 * read by no application code, `first_response_due_at` was never written, and
 * `mail.sla.breached` was never emitted. A team could miss every promise it had
 * made and the product would show a green tick, because the only test in the
 * suite called `addBusinessMinutes` directly and it was right.
 *
 * ── WHY THE SWEEP COMPUTES DUE DATES RATHER THAN INGEST ─────────────────────
 *
 * Setting the due date at arrival is the obvious design and the wrong one here.
 * Policies are tenant-editable, so a lead who shortens the VIP promise from
 * four hours to one expects it to apply to what is already in the queue; a due
 * date stamped at arrival would apply it only to mail that has not come yet.
 * Recomputing on a sweep also makes the whole thing idempotent and recoverable
 * — a worker outage costs lateness in the ALERT, never a lost clock.
 *
 * Everything here is written to survive being run twice.
 */
"use strict";

const clock = require("./sla-clock");
const notify = require("../../notification/notification.service");
const { emitEvent } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

async function calendar(client) {
  const [hours, holidays] = await Promise.all([
    client.query(`SELECT day_of_week, opens_at, closes_at, timezone FROM business_hours ORDER BY day_of_week`)
      .then((r) => r.rows).catch(() => []),
    client.query(`SELECT holiday_on FROM business_holiday`).then((r) => r.rows).catch(() => []),
  ]);
  return { hours, holidays };
}

async function policies(client) {
  return client.query(
    `SELECT * FROM mail_sla_policy WHERE is_active ORDER BY applies_to_vip DESC`,
  ).then((r) => r.rows).catch(() => []);
}

/**
 * The policy that governs a thread.
 *
 * Most specific first: a policy bound to this mailbox beats a tenant-wide one,
 * and a VIP policy beats the ordinary one for a VIP thread. Ordering the rows
 * `applies_to_vip DESC` and taking the first match is what makes the VIP tier
 * actually mean something — the old `dueAt` had a VIP branch that returned the
 * ordinary number.
 */
function policyFor(rows, thread) {
  const eligible = rows.filter((p) =>
    (!p.email_connection_id || p.email_connection_id === thread.email_connection_id)
    && (!p.applies_to_vip || thread.is_vip));
  const scoped = eligible.filter((p) => p.email_connection_id);
  return scoped[0] || eligible[0] || null;
}

/**
 * Derive `first_responded_at` from the messages rather than trusting a flag.
 *
 * A first response is "we sent something after they wrote", which the message
 * table already knows. Deriving it means the clock cannot drift out of step
 * with what actually happened, and means a reply sent from the user's phone —
 * which reaches us through the Sent-folder sync, not through our own send path
 * — still stops the clock.
 */
const RESPONDED = `
  UPDATE email_thread t SET first_responded_at = sub.first_out
    FROM (SELECT email_thread_id, min(received_at) AS first_out
            FROM email_message WHERE direction = 'OUT' GROUP BY email_thread_id) sub
   WHERE sub.email_thread_id = t.email_thread_id
     AND t.first_responded_at IS DISTINCT FROM sub.first_out`;

async function sweep(client, { now = new Date() } = {}) {
  const rows = await policies(client);
  if (!rows.length) return { policies: 0, dated: 0, breached: 0 };

  const ctx = await calendar(client);
  await client.query(RESPONDED);

  // Only threads that still need a due date. Recomputing every open thread on
  // every tick would be correct and wasteful; a policy change is picked up by
  // the reset below instead.
  const { rows: pending } = await client.query(
    `SELECT t.email_thread_id, t.email_connection_id, t.is_vip, t.first_message_at,
            t.work_status, t.first_responded_at, t.resolved_at
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.work_status = 'OPEN'
        AND t.first_response_due_at IS NULL
        AND c.kind IN ('SHARED','DELEGATED')
      LIMIT 500`,
  );

  let dated = 0;
  for (const t of pending) {
    const policy = policyFor(rows, t);
    if (!policy) continue;
    const dues = clock.dueDates(t.first_message_at || now, policy, ctx);
    if (!dues.first_response_due_at) continue;
    await client.query(
      `UPDATE email_thread SET first_response_due_at = $2, resolution_due_at = $3
        WHERE email_thread_id = $1`,
      [t.email_thread_id, dues.first_response_due_at, dues.resolution_due_at],
    );
    dated += 1;
  }

  // Breaches. `sla_breached_at IS NULL` makes this fire once per thread, so a
  // worker that runs every five minutes does not notify a team lead every five
  // minutes about the same overdue thread — which is how an alert gets muted
  // and then ignored.
  const { rows: breaches } = await client.query(
    `UPDATE email_thread t SET sla_breached_at = $1
      WHERE t.sla_breached_at IS NULL
        AND t.work_status = 'OPEN'
        AND t.first_responded_at IS NULL
        AND t.first_response_due_at IS NOT NULL
        AND t.first_response_due_at <= $1
      RETURNING t.email_thread_id, t.email_connection_id, t.subject, t.assigned_user_id`,
    [now],
  );

  for (const b of breaches) {
    try {
      await announce(client, b);
    } catch (err) {
      logger.warn({ err, thread: b.email_thread_id }, "[mail] SLA breach notification failed");
    }
  }
  return { policies: rows.length, dated, breached: breaches.length };
}

/**
 * Tell the people who can do something about it.
 *
 * MANAGERs on the mailbox, plus whoever holds the thread. §9.2 says "the team
 * lead"; MANAGER is that role in the PR-0 access model (P3), so this does not
 * need its own notion of who leads a team.
 */
async function announce(client, thread) {
  const { rows: managers } = await client.query(
    `SELECT user_id FROM email_connection_member
      WHERE email_connection_id = $1 AND member_role = 'MANAGER' AND revoked_at IS NULL`,
    [thread.email_connection_id],
  );
  const targets = [...new Set([...managers.map((m) => m.user_id), thread.assigned_user_id].filter(Boolean))];

  for (const userId of targets) {
    await notify.notify(client, {
      userId,
      eventTypeKey: "mail.sla.breached",
      title: "First-response SLA missed",
      body: thread.subject ? `No reply yet on «${thread.subject}»` : "A conversation is past its first-response time.",
      entityRef: `email_thread:${thread.email_thread_id}`,
      priority: "HIGH",
      // One breach, one notification per person, forever — the sweep's own
      // `sla_breached_at IS NULL` guard already fires once, and this is the
      // belt to that pair of braces.
      dedupeKey: `SLA_BREACH:email_thread:${thread.email_thread_id}:${userId}`,
    });
  }
  await emitEvent(client, {
    eventTypeKey: "mail.sla.breached",
    moduleKey: "MOD-72",
    entityRef: `email_thread:${thread.email_thread_id}`,
    actorUserId: null,
    payload: { connection: thread.email_connection_id, notified: targets.length },
  }).catch(() => { /* @silent:storage the sla_breached_at stamp is the record */ });
  return targets.length;
}

/**
 * Clear computed due dates so the next sweep recomputes them.
 *
 * Called when a policy or the business calendar is edited. Without it, a lead
 * who shortens the VIP promise would see it apply only to future mail, which is
 * not what "we now answer VIPs in an hour" means to the person who said it.
 */
const resetComputed = (client) =>
  client.query(
    `UPDATE email_thread SET first_response_due_at = NULL, resolution_due_at = NULL
      WHERE work_status = 'OPEN' AND first_responded_at IS NULL`,
  ).then((r) => ({ reset: r.rowCount }));

module.exports = { sweep, announce, policyFor, calendar, policies, resetComputed };
