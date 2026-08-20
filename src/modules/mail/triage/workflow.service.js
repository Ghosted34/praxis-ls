/**
 * The PR-5 administration surface (§9.9) — soft locks, SLA policy, the business
 * calendar, thread sharing, verified domains and bounces.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `triage.routes.js` shipped eight of the twenty-odd endpoints §9.9 lists, with
 * the SQL inlined in the route handlers. That was survivable while the module
 * was three endpoints; it is not survivable now, because half of these have a
 * rule attached that a route body is the wrong place for — a lock that must not
 * be stolen from a colleague who is still typing, a policy edit that has to
 * clear the due dates it invalidates, an `OBSERVED` domain that must never be
 * promotable by anything but a human.
 *
 * So the rules live here and the routes stay thin. Everything takes an explicit
 * `actor`, because every one of these writes is attributable and several are
 * audited.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const sla = require("./sla.service");

const M = "MOD-72";

/* ── Soft locks (§9.2) ────────────────────────────────────────────────────── */

/**
 * Advisory, short-lived, refreshed by a heartbeat.
 *
 * §9.2 is emphatic that this is "advisory, never a hard block, because a stale
 * lock that blocks a customer reply is worse than a duplicated one". So:
 *
 *  · taking a lock someone else holds does NOT fail — it returns theirs, with
 *    `held_by_other: true`, and the UI says "Marie started replying 40 seconds
 *    ago" with the option to continue anyway;
 *  · an EXPIRED lock is taken silently, because its holder has stopped typing;
 *  · the heartbeat is the same call, so the client has one thing to poll.
 *
 * Two minutes, refreshed every 30s while typing, per §9.2.
 */
const LOCK_SECONDS = 120;

async function takeLock(client, threadId, actor = {}) {
  if (!actor.user_id) throw new AppError("VALIDATION_ERROR", "a lock needs a holder", 422);
  const { rows } = await client.query(
    `INSERT INTO email_thread_lock (email_thread_id, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (email_thread_id) DO UPDATE
        SET user_id    = CASE WHEN email_thread_lock.expires_at <= now()
                                OR email_thread_lock.user_id = EXCLUDED.user_id
                              THEN EXCLUDED.user_id ELSE email_thread_lock.user_id END,
            expires_at = CASE WHEN email_thread_lock.expires_at <= now()
                                OR email_thread_lock.user_id = EXCLUDED.user_id
                              THEN EXCLUDED.expires_at ELSE email_thread_lock.expires_at END
     RETURNING *`,
    [threadId, actor.user_id, LOCK_SECONDS],
  );
  const lock = rows[0];
  const mine = lock.user_id === actor.user_id;
  let holder = null;
  if (!mine) {
    holder = await client.query(
      `SELECT full_name FROM app_user WHERE user_id = $1`, [lock.user_id],
    ).then((r) => (r.rows[0] || {}).full_name || null).catch(() => null);
  }
  return {
    ...lock,
    held_by_me: mine,
    held_by_other: !mine,
    holder_name: holder,
    // The number the UI needs to say "40 seconds ago" without a second call.
    seconds_remaining: Math.max(0, Math.round((new Date(lock.expires_at) - Date.now()) / 1000)),
  };
}

/** Release only your OWN lock. Releasing a colleague's is how a race starts. */
const releaseLock = (client, threadId, actor = {}) =>
  client.query(
    `DELETE FROM email_thread_lock WHERE email_thread_id = $1 AND user_id = $2 RETURNING email_thread_id`,
    [threadId, actor.user_id || null],
  ).then((r) => ({ released: r.rows.length > 0 }));

/* ── SLA policy (§9.2) ────────────────────────────────────────────────────── */

const listPolicies = (client) =>
  client.query(
    `SELECT p.*, c.email_address AS mailbox_address
       FROM mail_sla_policy p
       LEFT JOIN email_connection c ON c.email_connection_id = p.email_connection_id
      ORDER BY p.applies_to_vip DESC, p.name`,
  ).then((r) => r.rows);

const POLICY_FIELDS = [
  "name", "email_connection_id", "applies_to_vip",
  "first_response_minutes", "resolution_minutes", "business_hours_only", "is_active",
];

async function createPolicy(client, body = {}, actor = {}) {
  const { rows } = await client.query(
    `INSERT INTO mail_sla_policy
       (name, email_connection_id, applies_to_vip, first_response_minutes,
        resolution_minutes, business_hours_only, is_active)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),COALESCE($7,true)) RETURNING *`,
    [
      body.name, body.email_connection_id || null, body.applies_to_vip === true,
      body.first_response_minutes, body.resolution_minutes,
      body.business_hours_only, body.is_active,
    ],
  );
  await afterPolicyChange(client, rows[0], actor, "created");
  return rows[0];
}

async function updatePolicy(client, id, patch = {}, actor = {}) {
  const sets = [];
  const params = [id];
  for (const f of POLICY_FIELDS) {
    if (patch[f] !== undefined) { params.push(patch[f]); sets.push(`${f} = $${params.length}`); }
  }
  if (!sets.length) throw new AppError("VALIDATION_ERROR", "nothing to update", 422);
  const { rows } = await client.query(
    `UPDATE mail_sla_policy SET ${sets.join(", ")} WHERE mail_sla_policy_id = $1 RETURNING *`,
    params,
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "policy not found", 404);
  await afterPolicyChange(client, rows[0], actor, "updated");
  return rows[0];
}

/**
 * A policy edit applies to the queue, not only to future mail.
 *
 * When a lead shortens the VIP promise from four hours to one, they mean the
 * threads sitting in the queue right now. Due dates are computed by the sweep
 * from `first_message_at`, so clearing them is enough — the next tick recomputes
 * under the new policy. Without this the change would apply only to mail that
 * has not arrived yet, which is not what "we now answer VIPs in an hour" means
 * to the person who said it.
 */
async function afterPolicyChange(client, row, actor, verb) {
  const reset = await sla.resetComputed(client);
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: `mail.sla_policy.${verb}`,
    moduleKey: M,
    entityRef: `mail_sla_policy:${row.mail_sla_policy_id}`,
    after: row,
  }).catch(() => { /* @silent:storage the policy row is the outcome */ });
  return reset;
}

/* ── The business calendar (§9.2) ─────────────────────────────────────────── */

const getCalendar = async (client) => ({
  hours: await client.query(
    `SELECT day_of_week, opens_at, closes_at, timezone FROM business_hours ORDER BY day_of_week`,
  ).then((r) => r.rows),
  holidays: await client.query(
    `SELECT holiday_on, name FROM business_holiday ORDER BY holiday_on`,
  ).then((r) => r.rows),
});

/**
 * Replace the week wholesale.
 *
 * A PUT rather than a per-day PATCH because a business week is edited as a
 * week: closing on Saturday and opening earlier on Monday is one decision, and
 * applying half of it is a calendar nobody meant.
 */
async function putBusinessHours(client, rows = [], actor = {}) {
  if (!Array.isArray(rows)) throw new AppError("VALIDATION_ERROR", "hours must be a list", 422);
  await client.query(`DELETE FROM business_hours`);
  for (const h of rows) {
    await client.query(
      `INSERT INTO business_hours (day_of_week, opens_at, closes_at, timezone)
       VALUES ($1,$2,$3,COALESCE($4,'Africa/Douala'))`,
      [h.day_of_week, h.opens_at, h.closes_at, h.timezone || null],
    );
  }
  await sla.resetComputed(client);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.business_hours.set",
    moduleKey: M, entityRef: "business_hours:all", after: { days: rows.length },
  }).catch(() => { /* @silent:storage */ });
  return getCalendar(client);
}

async function putHolidays(client, rows = [], actor = {}) {
  if (!Array.isArray(rows)) throw new AppError("VALIDATION_ERROR", "holidays must be a list", 422);
  await client.query(`DELETE FROM business_holiday`);
  for (const h of rows) {
    await client.query(
      `INSERT INTO business_holiday (holiday_on, name) VALUES ($1,$2)
       ON CONFLICT (holiday_on) DO NOTHING`,
      [h.holiday_on, h.name || null],
    );
  }
  await sla.resetComputed(client);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.holidays.set",
    moduleKey: M, entityRef: "business_holiday:all", after: { count: rows.length },
  }).catch(() => { /* @silent:storage */ });
  return getCalendar(client);
}

/* ── Thread sharing (§9.5) ────────────────────────────────────────────────── */

/**
 * Grant one named colleague sight of one Private thread.
 *
 * This is the escape valve that makes PRIVATE usable: without it the only way
 * to bring somebody in is to widen the whole thread to TEAM, and a visibility
 * model whose only granularity is "me" or "everyone" gets set to everyone.
 * Audited, because it is a disclosure.
 */
async function shareThread(client, threadId, userId, actor = {}) {
  if (!userId) throw new AppError("VALIDATION_ERROR", "user_id is required", 422);
  const { rows } = await client.query(
    `INSERT INTO email_thread_share (email_thread_id, user_id, granted_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (email_thread_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by
     RETURNING *`,
    [threadId, userId, actor.user_id || null],
  );
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.thread.shared",
    moduleKey: M, entityRef: `email_thread:${threadId}`,
    after: { with: userId }, isSensitive: true,
  }).catch(() => { /* @silent:storage the share row is the outcome */ });
  return rows[0];
}

async function unshareThread(client, threadId, userId, actor = {}) {
  const { rows } = await client.query(
    `DELETE FROM email_thread_share WHERE email_thread_id = $1 AND user_id = $2 RETURNING *`,
    [threadId, userId],
  );
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.thread.unshared",
    moduleKey: M, entityRef: `email_thread:${threadId}`,
    before: rows[0] || null, after: { with: userId },
  }).catch(() => { /* @silent:storage */ });
  return { removed: rows.length > 0 };
}

const listShares = (client, threadId) =>
  client.query(
    `SELECT s.user_id, s.granted_at, u.full_name
       FROM email_thread_share s JOIN app_user u ON u.user_id = s.user_id
      WHERE s.email_thread_id = $1 ORDER BY s.granted_at`,
    [threadId],
  ).then((r) => r.rows);

/* ── Verified domains (§9.7) ──────────────────────────────────────────────── */

const listVerifiedDomains = (client, { partyKind = null, partyId = null } = {}) =>
  client.query(
    `SELECT d.*, d.domain::text AS domain
       FROM party_verified_domain d
      WHERE ($1::text IS NULL OR d.party_kind = $1)
        AND ($2::uuid IS NULL OR d.party_id = $2)
      ORDER BY d.source, d.domain`,
    [partyKind, partyId],
  ).then((r) => r.rows);

/**
 * Mark a domain as belonging to a party — the one-click action behind the
 * UNVERIFIED banner.
 *
 * `ADMIN_VERIFIED` is the ONLY source this endpoint can write. §9.7: "OBSERVED
 * domains accrue automatically from correspondence history but never confer
 * VERIFIED on their own — that requires a human, in the UI, once." An API that
 * could set OBSERVED would let the ingest path launder itself into trust.
 */
async function verifyDomain(client, { partyKind, partyId, domain }, actor = {}) {
  if (!partyKind || !partyId || !domain) {
    throw new AppError("VALIDATION_ERROR", "party_kind, party_id and domain are required", 422);
  }
  const { rows } = await client.query(
    `INSERT INTO party_verified_domain (party_kind, party_id, domain, source, verified_by, verified_at)
     VALUES ($1,$2,$3,'ADMIN_VERIFIED',$4, now())
     ON CONFLICT (party_kind, party_id, domain) DO UPDATE
        SET source = 'ADMIN_VERIFIED', verified_by = EXCLUDED.verified_by, verified_at = now()
     RETURNING *, domain::text AS domain`,
    [String(partyKind).toUpperCase(), partyId, String(domain).toLowerCase().trim(), actor.user_id || null],
  );
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.domain.verified",
    moduleKey: M, entityRef: `${String(partyKind).toLowerCase()}:${partyId}`,
    after: rows[0], isSensitive: true,
  }).catch(() => { /* @silent:storage */ });
  await emitEvent(client, {
    eventTypeKey: "mail.domain.verified", moduleKey: M,
    entityRef: `${String(partyKind).toLowerCase()}:${partyId}`,
    actorUserId: actor.user_id || null, payload: { domain: rows[0].domain },
  }).catch(() => { /* @silent:storage */ });
  return rows[0];
}

/**
 * Withdrawing trust is audited as heavily as granting it.
 *
 * A domain that silently stops being verified is how a lookalike gets a clean
 * banner — and it is the change an attacker with a foothold would most like to
 * make quietly.
 */
async function unverifyDomain(client, id, actor = {}) {
  const { rows } = await client.query(
    `DELETE FROM party_verified_domain WHERE party_verified_domain_id = $1
     RETURNING *, domain::text AS domain`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "domain not found", 404);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.domain.unverified",
    moduleKey: M, entityRef: `${rows[0].party_kind.toLowerCase()}:${rows[0].party_id}`,
    before: rows[0], isSensitive: true,
  }).catch(() => { /* @silent:storage */ });
  return { removed: true, domain: rows[0].domain };
}

/* ── Bounces (§9.8) ───────────────────────────────────────────────────────── */

const listBounces = (client, { limit = 100, recipient = null, type = null } = {}) =>
  client.query(
    `SELECT b.*, b.recipient::text AS recipient, m.subject AS original_subject
       FROM email_bounce b
       LEFT JOIN email_message m ON m.email_message_id = b.original_message_id
      WHERE ($2::text IS NULL OR b.recipient = $2::citext)
        AND ($3::text IS NULL OR b.bounce_type = $3)
      ORDER BY b.reported_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500), recipient, type],
  ).then((r) => r.rows);

/**
 * The composer's pre-send warning.
 *
 * Returns only the addresses worth warning about, so the caller can show
 * "x@y.cm has hard-bounced — the mailbox does not exist" before the send rather
 * than after the third attempt. Reads the CONTACT status rather than the bounce
 * log, because that is where the fact about the address lives.
 */
const addressStatus = (client, addresses = []) => {
  const list = [...new Set((addresses || []).filter(Boolean).map((a) => String(a).toLowerCase()))];
  if (!list.length) return Promise.resolve([]);
  return client.query(
    `SELECT lower(email) AS email, email_status FROM client_contact
      WHERE lower(email) = ANY($1) AND email_status <> 'OK'
     UNION
     SELECT lower(email), email_status FROM supplier_contact
      WHERE lower(email) = ANY($1) AND email_status <> 'OK'`,
    [list],
  ).then((r) => r.rows).catch(() => []);
};

/* ── Follow-ups (§9.3) ────────────────────────────────────────────────────── */

/**
 * Cancel a follow-up you set.
 *
 * Scoped to the owner: a snooze is a promise the product made to ONE person,
 * and a colleague cancelling it means the thread never comes back for someone
 * who is still expecting it.
 */
const cancelFollowup = (client, id, actor = {}) =>
  client.query(
    `UPDATE email_followup SET status = 'CANCELLED'
      WHERE email_followup_id = $1 AND user_id = $2 AND status = 'PENDING'
      RETURNING *`,
    [id, actor.user_id || null],
  ).then((r) => {
    if (!r.rows[0]) throw new AppError("NOT_FOUND", "follow-up not found, or not yours", 404);
    return r.rows[0];
  });

const listFollowups = (client, actor = {}) =>
  client.query(
    `SELECT f.*, t.subject
       FROM email_followup f
       LEFT JOIN email_thread t ON t.email_thread_id = f.email_thread_id
      WHERE f.user_id = $1 AND f.status = 'PENDING'
      ORDER BY f.due_at`,
    [actor.user_id || null],
  ).then((r) => r.rows);

module.exports = {
  LOCK_SECONDS,
  takeLock, releaseLock,
  listPolicies, createPolicy, updatePolicy,
  getCalendar, putBusinessHours, putHolidays,
  shareThread, unshareThread, listShares,
  listVerifiedDomains, verifyDomain, unverifyDomain,
  listBounces, addressStatus,
  cancelFollowup, listFollowups,
};
