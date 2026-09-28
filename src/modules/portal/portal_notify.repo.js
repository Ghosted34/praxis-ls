/**
 * Client portal notifications (14180) — SQL.
 *
 * Every read that decides WHO is told is scoped to one client in SQL, and goes
 * through the same grant rule as signing in: a person's effective CLIENT grant
 * is their newest active one (portal.repo.activeFor), so somebody moved to
 * another company's account is not still told about this one.
 */
"use strict";

/* ── settings ──────────────────────────────────────────────────────────── */

async function setting(client, { clientId, email }) {
  const { rows } = await client.query(
    "SELECT language, email_off, push_off FROM portal_notify_setting WHERE client_id = $1 AND subject_email = $2",
    [clientId, email],
  );
  return rows[0] || null;
}

async function saveSetting(client, { clientId, email, language, emailOff, pushOff }) {
  const { rows } = await client.query(
    `INSERT INTO portal_notify_setting (client_id, subject_email, language, email_off, push_off)
     VALUES ($1, $2, $3, $4::text[], $5::text[])
     ON CONFLICT (client_id, subject_email) DO UPDATE
       SET language = COALESCE(EXCLUDED.language, portal_notify_setting.language),
           email_off = EXCLUDED.email_off, push_off = EXCLUDED.push_off, updated_at = now()
     RETURNING language, email_off, push_off`,
    [clientId, email, language || null, emailOff, pushOff],
  );
  return rows[0];
}

/**
 * Remember the language a person reads the portal in, without touching their
 * choices — the first device they allow notifications on is where it is learnt.
 */
async function rememberLanguage(client, { clientId, email, language, emailOff, pushOff }) {
  await client.query(
    `INSERT INTO portal_notify_setting (client_id, subject_email, language, email_off, push_off)
     VALUES ($1, $2, $3, $4::text[], $5::text[])
     ON CONFLICT (client_id, subject_email) DO UPDATE SET language = EXCLUDED.language, updated_at = now()`,
    [clientId, email, language, emailOff, pushOff],
  );
}

/* ── devices (always the LIVE schema: a device is identity) ────────────── */

async function saveDevice(client, { portalUserId, endpoint, p256dh, auth, userAgent, vapidKeyHash }) {
  await client.query(
    `INSERT INTO portal_push_subscription (endpoint, portal_user_id, p256dh, auth, user_agent, vapid_key_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
       SET portal_user_id = EXCLUDED.portal_user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           vapid_key_hash = COALESCE(EXCLUDED.vapid_key_hash, portal_push_subscription.vapid_key_hash),
           last_error = NULL, last_failed_at = NULL`,
    [endpoint, portalUserId, p256dh, auth, userAgent || null, vapidKeyHash || null],
  );
}

/** Only this person's own device: an endpoint alone never removes someone else's. */
async function deleteDevice(client, { portalUserId, endpoint }) {
  const { rowCount } = await client.query(
    "DELETE FROM portal_push_subscription WHERE endpoint = $1 AND portal_user_id = $2",
    [endpoint, portalUserId],
  );
  return rowCount;
}

async function countDevices(client, portalUserId) {
  const { rows } = await client.query(
    "SELECT count(*)::int AS n FROM portal_push_subscription WHERE portal_user_id = $1",
    [portalUserId],
  );
  return rows[0] ? rows[0].n : 0;
}

/* ── who is told ───────────────────────────────────────────────────────── */

/**
 * The people at this client who can be told anything: an effective CLIENT
 * grant here, not expired, and a portal login that is active and has been
 * used — an invitation nobody has accepted yet is not a subscription to news.
 */
async function audience(client, { clientId }) {
  const { rows } = await client.query(
    `WITH here AS (
       SELECT DISTINCT subject_email FROM portal_access
        WHERE portal = 'CLIENT' AND client_id = $1 AND is_active
     ), effective AS (
       SELECT DISTINCT ON (a.subject_email) a.*
         FROM portal_access a
         JOIN here h ON h.subject_email = a.subject_email
        WHERE a.portal = 'CLIENT' AND a.is_active
        ORDER BY a.subject_email, a.created_at DESC
     )
     SELECT e.subject_email AS email, e.access_scope AS scope, e.created_at AS granted_at,
            u.portal_user_id, u.full_name,
            s.language, s.email_off, s.push_off,
            (SELECT count(*) FROM portal_push_subscription ps
              WHERE ps.portal_user_id = u.portal_user_id)::int AS devices
       FROM effective e
       JOIN portal_user u ON u.email = e.subject_email
       LEFT JOIN portal_notify_setting s ON s.client_id = e.client_id AND s.subject_email = e.subject_email
      WHERE e.client_id = $1
        AND (e.expires_at IS NULL OR e.expires_at > now())
        AND u.status = 'ACTIVE' AND u.last_login_at IS NOT NULL`,
    [clientId],
  );
  return rows;
}

/** The client's name and language, for the words of an email. */
async function clientProfile(client, clientId) {
  const { rows } = await client.query(
    "SELECT COALESCE(name, legal_name) AS name, preferred_language FROM client_master WHERE client_id = $1",
    [clientId],
  );
  return rows[0] || null;
}

/* ── the outbox ────────────────────────────────────────────────────────── */

const DONE_COLUMN = { push: "push_done_at", email: "email_done_at" };

/** What is waiting on one channel for this client, topic and conversation. */
async function waiting(client, { clientId, topic, thread, channel, limit = 50 }) {
  const col = DONE_COLUMN[channel];
  const { rows } = await client.query(
    `SELECT outbox_id, event_key, item_ref, created_at
       FROM portal_notify_outbox
      WHERE client_id = $1 AND topic = $2 AND thread_key IS NOT DISTINCT FROM $3 AND ${col} IS NULL
      ORDER BY outbox_id
      LIMIT $4`,
    [clientId, topic, thread || null, limit],
  );
  return rows;
}

async function markDone(client, { ids, channel }) {
  if (!ids.length) return;
  const col = DONE_COLUMN[channel];
  await client.query(`UPDATE portal_notify_outbox SET ${col} = now() WHERE outbox_id = ANY($1::bigint[])`, [ids]);
}

/**
 * Groups with rows left waiting past their job — a queue that was down when
 * the event happened, or a job lost to a restart. The next job in the tenant
 * re-queues them, so a notification is late rather than never.
 */
async function staleGroups(client, { olderThanMinutes = 30, limit = 20 } = {}) {
  const { rows } = await client.query(
    `SELECT client_id, topic, thread_key
       FROM portal_notify_outbox
      WHERE (push_done_at IS NULL OR email_done_at IS NULL)
        AND created_at < now() - make_interval(mins => $1)
      GROUP BY client_id, topic, thread_key
      LIMIT $2`,
    [olderThanMinutes, limit],
  );
  return rows.map((r) => ({ clientId: r.client_id, topic: r.topic, thread: r.thread_key }));
}

/* ── what was sent ─────────────────────────────────────────────────────── */

/** The claim, taken before a send: false when this person was already told. */
async function claim(client, { clientId, email, channel, topic, key }) {
  const { rows } = await client.query(
    `INSERT INTO portal_notify_sent (client_id, subject_email, channel, topic, dedupe_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject_email, channel, dedupe_key) DO NOTHING
     RETURNING sent_id`,
    [clientId, email, channel, topic, key],
  );
  return rows[0] ? rows[0].sent_id : null;
}

/** Give a claim back when the send failed, so the retry can make it. */
async function release(client, sentId) {
  await client.query("DELETE FROM portal_notify_sent WHERE sent_id = $1", [sentId]);
}

/** Was this person emailed about this conversation recently? */
async function recentlyTold(client, { email, channel, topic, keyPrefix, minutes }) {
  const { rows } = await client.query(
    `SELECT 1 FROM portal_notify_sent
      WHERE subject_email = $1 AND channel = $2 AND topic = $3
        AND dedupe_key LIKE $4 || '%' AND sent_at > now() - make_interval(mins => $5)
      LIMIT 1`,
    [email, channel, topic, keyPrefix, minutes],
  );
  return rows.length > 0;
}

/** The sender keeps its own tables small: a month of claims, a day of finished rows. */
async function sweep(client) {
  await client.query("DELETE FROM portal_notify_sent WHERE sent_at < now() - interval '30 days'");
  await client.query(
    `DELETE FROM portal_notify_outbox
      WHERE push_done_at IS NOT NULL AND email_done_at IS NOT NULL AND created_at < now() - interval '1 day'`,
  );
}

/* ── the things a notification is about ────────────────────────────────── */

/**
 * Team replies in one conversation that this person has not read, oldest
 * first — the chat's own unread rule (portal_chat.repo UNREAD), limited to the
 * team's side: a colleague's message is theirs to read in the portal, not a
 * reason to be emailed.
 */
async function unreadReplies(client, { clientId, thread, portalUserId, since, ids }) {
  const { rows } = await client.query(
    `SELECT m.message_id, m.body, m.created_at, u.full_name AS author,
            (m.location_lat IS NOT NULL) AS has_location,
            (SELECT a.kind FROM client_message_attachment a
              WHERE a.message_id = m.message_id ORDER BY a.position LIMIT 1) AS attachment_kind,
            d.ref AS dossier_ref
       FROM client_message m
       LEFT JOIN app_user u ON u.user_id = m.author_user_id
       LEFT JOIN dossier_visible d ON d.dossier_id = m.dossier_id
       LEFT JOIN client_message_cursor cur
              ON cur.client_id = m.client_id AND cur.portal_user_id = $3 AND cur.thread_key = $2
      WHERE m.client_id = $1 AND COALESCE(m.dossier_id::text, 'general') = $2
        AND m.direction = 'STAFF'
        AND m.message_id = ANY($5::uuid[])
        AND m.created_at > COALESCE(cur.last_read_at, $4::timestamptz)
      ORDER BY m.created_at`,
    [clientId, thread, portalUserId, since || "epoch", ids],
  );
  return rows;
}

async function requests(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT r.client_request_id, r.kind, r.title, r.status, r.due_on, r.review_note, r.dossier_id,
            d.ref AS dossier_ref, dt.name_en AS doc_type_en, dt.name_fr AS doc_type_fr
       FROM client_request r
       LEFT JOIN dossier_visible d ON d.dossier_id = r.dossier_id
       LEFT JOIN dictionary_ref dt ON dt.kind = 'DOCUMENT_TYPE' AND dt.code::text = r.doc_type_code
      WHERE r.client_id = $1 AND r.client_request_id = ANY($2::uuid[])
        AND r.status IN ('OPEN','REJECTED')`,
    [clientId, ids],
  );
  return rows;
}

/** Final invoices the client can see (billingInvoices' rule), with a document count. */
async function invoices(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT i.invoice_id, i.doc_number, i.currency, i.total_ttc, i.payment_due_on,
            (SELECT count(*)::int FROM invoice_client_bundle b
               JOIN invoice_client_bundle_item it ON it.bundle_id = b.bundle_id
              WHERE b.invoice_id = i.invoice_id) AS documents
       FROM invoice i
      WHERE i.client_id = $1 AND i.invoice_id = ANY($2::uuid[]) AND i.type = 'FINAL'
        AND i.status NOT IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL','CANCELLED','REVERSED')`,
    [clientId, ids],
  );
  return rows;
}

async function proofs(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT payment_proof_id, status, amount, currency, review_note
       FROM payment_proof
      WHERE client_id = $1 AND payment_proof_id = ANY($2::uuid[]) AND status IN ('CONFIRMED','REJECTED')`,
    [clientId, ids],
  );
  return rows;
}

/** Proposals still waiting on the client — an answered one is no longer news. */
async function proposals(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT proposal_id, doc_number, title
       FROM proposal
      WHERE client_id = $1 AND proposal_id = ANY($2::uuid[]) AND status = 'SENT'`,
    [clientId, ids],
  );
  return rows;
}

/** Completed stages the client can see, on their own shipments. */
async function stages(client, { clientId, ids }) {
  const { rows } = await client.query(
    `SELECT mi.milestone_instance_id, mi.label, mi.label_en, mi.completed_at,
            d.dossier_id, d.ref AS dossier_ref
       FROM milestone_instance mi
       JOIN dossier_visible d ON d.dossier_id = mi.dossier_id
      WHERE d.client_id = $1 AND mi.milestone_instance_id = ANY($2::uuid[])
        AND mi.is_client_visible AND mi.status = 'DONE'
      ORDER BY mi.completed_at`,
    [clientId, ids],
  );
  return rows;
}

module.exports = {
  setting, saveSetting, rememberLanguage,
  saveDevice, deleteDevice, countDevices,
  audience, clientProfile,
  waiting, markDone, staleGroups,
  claim, release, recentlyTold, sweep,
  unreadReplies, requests, invoices, proofs, proposals, stages,
};
