/**
 * SQL for the thread/message model.
 *
 * Split from mail.repo.js, which keeps the connection and identity access it has
 * always had. This file owns conversations, messages, per-user state, folders and
 * labels — the things 10731 and 10732 introduced.
 *
 * ── EVERY citext[] READ IS CAST TO text[] — THIS IS NOT OPTIONAL ────────────
 *
 * `participants`, `to_address` and `cc_address` are `citext[]`, which buys
 * case-insensitive comparison on addresses. The cost is that node-postgres has
 * no type parser for it: `citext` comes from an extension, so its array OID is
 * not one of the built-ins pg knows how to decode, and it hands back the RAW
 * POSTGRES LITERAL as a string — `"{a@b.cm,c@d.cm}"` — instead of an array.
 *
 * Nothing complains. The row looks fine in a log. Then the first `.filter` or
 * `.join` on it throws, and because these feed the inbox list, one uncast
 * SELECT takes down the entire Mailbox screen behind an error boundary. That is
 * exactly what happened after PR-1A shipped.
 *
 * So: `::text[]` on every read of one of these columns, including inside
 * `SELECT t.*`, where the cast is appended as a same-named column because
 * Postgres allows the duplicate and node-postgres keeps the LAST one. Writes
 * need no cast — pg sends a JS array as `text[]` and Postgres coerces it going
 * in. `scripts/check-citext-arrays.js` fails the build on a read that forgets.
 *
 * ── ONE PLACE DECIDES WHAT A USER MAY SEE ───────────────────────────────────
 *
 * `accessibleConnections` is the single predicate for "which mailboxes is this
 * person allowed to read" — their own personal one, plus every shared or
 * delegated mailbox they hold a live grant on. Every list, get, search and count
 * in this file goes through it. A second copy of that rule is a leak, so there
 * is not one.
 */
"use strict";

const { updateOne, getById } = require("../../../shared/db/query-helpers");
const visibility = require("../triage/visibility");

/**
 * ── AND THE SECOND PREDICATE: PER-THREAD VISIBILITY (PR-5 §9.5) ─────────────
 *
 * `accessible` answers "which MAILBOXES may this person open".
 * `vis` answers the finer question "which THREADS inside those mailboxes may
 * they see" — Private / Team / Company. They are different rules and both are
 * required: a colleague can legitimately hold a grant on a shared mailbox and
 * still have no business reading a thread its owner marked Private.
 *
 * The predicate is defined ONCE, in `../triage/visibility.js`, and applied here
 * at every read: list, get, stream counts, label-apply and the CRM timeline.
 * `tests/security/mail-visibility-wiring.test.js` asserts each of those call
 * sites still carries it, because the failure mode is silent — a query that
 * drops the clause returns MORE rows, never an error, and every unit test that
 * exercises the predicate directly keeps passing while the product leaks.
 *
 * Every query using it must have `email_connection` joined as `c`, since
 * PRIVATE resolves through `c.owner_user_id`.
 */
const vis = (n) => visibility.clause(`$${n}`);

/**
 * ── THE TRIAGE FIELDS, UNDER THE NAMES THE CLIENT READS ─────────────────────
 *
 * `TriageBar` renders the SLA due line, who holds the composer lock, and the
 * assignee's name. Every one of those was `undefined` at runtime, for two
 * separate reasons, and neither produced an error — the bar just quietly drew
 * nothing and offered "Claim this" on a thread somebody had already claimed.
 *
 *   · `listThreads` selected an explicit column list that included none of the
 *     §9.2 columns at all. The whole triage bar was blank in the list.
 *   · `getThread` uses `SELECT t.*`, so it returned the columns — under their
 *     DATABASE names. `assigned_user_id`, `first_response_due_at` and
 *     `sla_breached_at` are not `assigned_to`, `sla_due_at` and `sla_breached`,
 *     and an optional field that never arrives is indistinguishable in TypeScript
 *     from one that is legitimately absent.
 *
 * Neither the client tests nor the server tests could see it: the client mocks
 * the API, so it was asserting my invented shape against my invented shape.
 * `scripts/check-response-contract.js` is what caught it, which is exactly the
 * job it exists to do.
 *
 * Defined once and shared by both queries, because the bar renders from the
 * list AND from the detail, and the two disagreeing is how this started.
 *
 * The lock join is deliberately `expires_at > now()` — an expired lock is not a
 * lock. §9.2 is emphatic that it is advisory, and showing "Thierry is writing a
 * reply" twenty minutes after Thierry closed his laptop is worse than showing
 * nothing.
 */
const TRIAGE_COLUMNS = `
            t.assigned_user_id AS assigned_to,
            au.full_name       AS assigned_to_name,
            t.work_status,
            t.visibility,
            t.first_response_due_at AS sla_due_at,
            (t.sla_breached_at IS NOT NULL) AS sla_breached,
            lk.user_id    AS locked_by,
            lu.full_name  AS locked_by_name,
            lk.expires_at AS lock_expires_at`;

const TRIAGE_JOINS = `
       LEFT JOIN app_user au ON au.user_id = t.assigned_user_id
       LEFT JOIN email_thread_lock lk
              ON lk.email_thread_id = t.email_thread_id AND lk.expires_at > now()
       LEFT JOIN app_user lu ON lu.user_id = lk.user_id`;

/**
 * The mailboxes this user may read, as a scalar subquery. Inlined rather than
 * fetched because it belongs inside the same plan as the query that uses it —
 * fetching a list of ids and passing it back in turns one query into two and
 * grows unbounded with the number of shared mailboxes.
 */
const ACCESSIBLE = `(
  SELECT c.email_connection_id FROM email_connection c
   WHERE c.status <> 'ARCHIVED'
     AND ( (c.kind = 'PERSONAL' AND c.owner_user_id = $USER)
        OR c.owner_user_id = $USER
        OR EXISTS (SELECT 1 FROM email_connection_member m
                    WHERE m.email_connection_id = c.email_connection_id
                      AND m.user_id = $USER AND m.revoked_at IS NULL) )
)`;
const accessible = (n) => ACCESSIBLE.replace(/\$USER/g, `$${n}`);

/* ── Threads ──────────────────────────────────────────────────────────────── */

/**
 * The inbox list.
 *
 * Read state is computed per user here rather than stored on the thread, because
 * "unread for me" is the whole point of the model: two people looking at the same
 * shared mailbox must see different counts from the same rows.
 */
async function listThreads(client, userId, q = {}) {
  const p = [userId];
  const add = (v) => { p.push(v); return `$${p.length}`; };
  const where = [`t.email_connection_id IN ${accessible(1)}`, vis(1)];

  if (q.connectionId) where.push(`t.email_connection_id = ${add(q.connectionId)}`);
  if (q.stream) where.push(`t.stream = ${add(q.stream)}`);
  if (q.vip) where.push("t.is_vip");
  if (q.entityRef) where.push(`t.entity_ref = ${add(q.entityRef)}`);
  if (q.folder) {
    where.push(`EXISTS (SELECT 1 FROM email_message m2 WHERE m2.email_thread_id = t.email_thread_id AND m2.folder = ${add(q.folder)})`);
  }
  if (q.hasAttachment) where.push("t.has_attachment");
  if (q.label) {
    where.push(`EXISTS (SELECT 1 FROM email_thread_label tl JOIN email_label l USING (email_label_id)
                         WHERE tl.email_thread_id = t.email_thread_id AND l.owner_user_id = $1 AND l.name = ${add(q.label)})`);
  }
  if (q.before) where.push(`t.last_message_at < ${add(q.before)}`);
  if (q.after) where.push(`t.last_message_at > ${add(q.after)}`);
  if (q.from && q.from.length) {
    where.push(`EXISTS (SELECT 1 FROM email_message m3 WHERE m3.email_thread_id = t.email_thread_id
                         AND m3.from_address::text ILIKE ANY (${add(q.from.map((f) => `%${f}%`))}))`);
  }
  if (q.to && q.to.length) {
    where.push(`EXISTS (SELECT 1 FROM email_message m4 WHERE m4.email_thread_id = t.email_thread_id
                         AND array_to_string(m4.to_address::text[], ' ') ILIKE ANY (${add(q.to.map((f) => `%${f}%`))}))`);
  }
  if (q.subject && q.subject.length) {
    for (const s of q.subject) where.push(`t.subject ILIKE ${add(`%${s}%`)}`);
  }
  if (q.tsquery) {
    // THE QUERY IS FOLDED TOO, with the same function that folded the document.
    //
    // 10733 stores `Déclaration` as the token `declaration`. Without folding
    // here, a user typing the word the way it is actually spelled in French —
    // with the accent — produces the token `déclaration`, which matches nothing.
    // The half of the corpus that most needs accent handling is exactly the half
    // that would have been broken, and it fails silently: no error, no results,
    // indistinguishable from "there is no such mail".
    where.push(`EXISTS (SELECT 1 FROM email_message m5 WHERE m5.email_thread_id = t.email_thread_id
                         AND m5.search_tsv @@ to_tsquery('simple', unaccent_safe(${add(q.tsquery)})))`);
  }
  // Unread and starred are per user, so they filter on the state rows, and
  // "unread" means NO state row at all as well as one saying false — a message
  // nobody has opened has no row.
  if (q.unread === true) {
    where.push(`EXISTS (SELECT 1 FROM email_message m6 WHERE m6.email_thread_id = t.email_thread_id
                         AND NOT EXISTS (SELECT 1 FROM email_message_state s6
                                          WHERE s6.email_message_id = m6.email_message_id AND s6.user_id = $1 AND s6.is_read))`);
  }
  if (q.unread === false) {
    where.push(`NOT EXISTS (SELECT 1 FROM email_message m7 WHERE m7.email_thread_id = t.email_thread_id
                             AND NOT EXISTS (SELECT 1 FROM email_message_state s7
                                              WHERE s7.email_message_id = m7.email_message_id AND s7.user_id = $1 AND s7.is_read))`);
  }
  if (q.starred) {
    where.push(`EXISTS (SELECT 1 FROM email_message m8 JOIN email_message_state s8 ON s8.email_message_id = m8.email_message_id
                         WHERE m8.email_thread_id = t.email_thread_id AND s8.user_id = $1 AND s8.is_starred)`);
  }

  const limit = add(Math.min(Math.max(Number(q.limit) || 50, 1), 200));
  const { rows } = await client.query(
    `SELECT t.email_thread_id, t.email_connection_id, t.thread_key, t.subject,
            t.participants::text[] AS participants,
            t.message_count, t.has_attachment, t.stream, t.stream_reason, t.is_vip, t.entity_ref,
            t.first_message_at, t.last_message_at,
            c.email_address AS mailbox_address, c.kind AS mailbox_kind,
            (SELECT count(*) FROM email_message mu
              WHERE mu.email_thread_id = t.email_thread_id
                AND NOT EXISTS (SELECT 1 FROM email_message_state su
                                 WHERE su.email_message_id = mu.email_message_id
                                   AND su.user_id = $1 AND su.is_read))::int AS unread_count,
            EXISTS (SELECT 1 FROM email_message ms JOIN email_message_state ss ON ss.email_message_id = ms.email_message_id
                     WHERE ms.email_thread_id = t.email_thread_id AND ss.user_id = $1 AND ss.is_starred) AS is_starred,
            (SELECT m9.body_preview FROM email_message m9
              WHERE m9.email_thread_id = t.email_thread_id ORDER BY m9.received_at DESC LIMIT 1) AS preview,
            (SELECT m10.from_address FROM email_message m10
              WHERE m10.email_thread_id = t.email_thread_id ORDER BY m10.received_at DESC LIMIT 1) AS last_from,
            ${TRIAGE_COLUMNS.trim()}
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
       ${TRIAGE_JOINS.trim()}
      WHERE ${where.join(" AND ")}
      ORDER BY t.is_vip DESC, t.last_message_at DESC
      LIMIT ${limit}`,
    p,
  );
  return rows;
}

/** One conversation with every message on it, in order. */
async function getThread(client, userId, threadId) {
  const { rows: head } = await client.query(
    // `t.*` first, then the aliases — a later same-named column wins in
    // node-postgres, so the client-facing names below override the raw ones
    // rather than colliding with them.
    `SELECT t.*, t.participants::text[] AS participants,
            c.email_address AS mailbox_address, c.kind AS mailbox_kind,
            ${TRIAGE_COLUMNS.trim()}
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
       ${TRIAGE_JOINS.trim()}
      WHERE t.email_thread_id = $2 AND t.email_connection_id IN ${accessible(1)}
        AND ${vis(1)}`,
    [userId, threadId],
  );
  if (!head[0]) return null;
  const { rows: messages } = await client.query(
    `SELECT m.email_message_id, m.direction, m.folder, m.from_address, m.from_name,
            m.to_address::text[] AS to_address, m.cc_address::text[] AS cc_address,
            m.subject, m.body_html, m.body_text, m.body_preview,
            m.received_at, m.has_attachment, m.sent_via, m.origin_send_point,
            u.full_name AS origin_user_name,
            COALESCE(s.is_read, false) AS is_read, COALESCE(s.is_starred, false) AS is_starred
       FROM email_message m
       LEFT JOIN email_message_state s ON s.email_message_id = m.email_message_id AND s.user_id = $1
       LEFT JOIN app_user u ON u.user_id = m.origin_user_id
      WHERE m.email_thread_id = $2
      ORDER BY m.received_at`,
    [userId, threadId],
  );
  return { ...head[0], messages };
}

/**
 * The ONE read that skips both predicates — break-glass (§9.5), and nothing else.
 *
 * It is named `Unrestricted` rather than given an `{ all: true }` option on
 * `getThread`, so that a grep for what bypasses visibility returns exactly one
 * function and its call sites. `tests/security/mail-visibility-wiring.test.js`
 * asserts that the only caller is the CEO-gated break-glass route, which writes
 * the `immutable_ledger` row before it reads.
 */
async function getThreadUnrestricted(client, threadId) {
  const { rows: head } = await client.query(
    `SELECT t.*, t.participants::text[] AS participants,
            c.email_address AS mailbox_address, c.kind AS mailbox_kind
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.email_thread_id = $1`,
    [threadId],
  );
  if (!head[0]) return null;
  const { rows: messages } = await client.query(
    `SELECT m.email_message_id, m.direction, m.folder, m.from_address, m.from_name,
            m.to_address::text[] AS to_address, m.cc_address::text[] AS cc_address,
            m.subject, m.body_html, m.body_text, m.body_preview, m.received_at,
            m.has_attachment, m.sent_via, m.origin_send_point
       FROM email_message m
      WHERE m.email_thread_id = $1
      ORDER BY m.received_at`,
    [threadId],
  );
  return { ...head[0], messages };
}

const getThreadById = (client, id) => getById(client, "email_thread", "email_thread_id", id);
const updateThread = (client, id, patch) => updateOne(client, "email_thread", "email_thread_id", id, patch);

/** Upsert a conversation on (connection, thread_key) and return it. */
const upsertThread = (client, row) =>
  client.query(
    `INSERT INTO email_thread
       (email_connection_id, thread_key, subject, participants, message_count, has_attachment,
        stream, stream_reason, is_vip, entity_ref, first_message_at, last_message_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (email_connection_id, thread_key) DO UPDATE
        SET subject          = COALESCE(email_thread.subject, EXCLUDED.subject),
            -- UNIONED, not overwritten. Every other field on this clause is
            -- written defensively — COALESCE, OR, LEAST, GREATEST — because a
            -- later message must not clobber what the conversation already
            -- knows. Participants was the one exception, and it is the field
            -- that most obviously has to accumulate: the upsert runs with only
            -- THIS message's addresses, so an assignment dropped everyone who
            -- had written earlier. A thread would end up listing whoever spoke
            -- last, which is exactly the "who is in this?" question the column
            -- exists to answer.
            --
            -- DISTINCT over citext folds case, so Client@Maersk.CM and
            -- client@maersk.cm collapse to one — the reason the column is
            -- citext in the first place. Sorted for a stable order.
            participants     = ARRAY(
              SELECT DISTINCT p FROM unnest(email_thread.participants || EXCLUDED.participants) AS p
               ORDER BY p),
            has_attachment   = email_thread.has_attachment OR EXCLUDED.has_attachment,
            first_message_at = LEAST(email_thread.first_message_at, EXCLUDED.first_message_at),
            last_message_at  = GREATEST(email_thread.last_message_at, EXCLUDED.last_message_at),
            -- entity_ref and stream are decided once, on the first message. A
            -- later message must not silently re-file a conversation somebody
            -- has already bound or corrected.
            entity_ref       = COALESCE(email_thread.entity_ref, EXCLUDED.entity_ref)
      RETURNING *, participants::text[] AS participants`,
    [row.email_connection_id, row.thread_key, row.subject || null, row.participants || [],
     row.message_count || 0, row.has_attachment === true, row.stream || "HUMAN",
     row.stream_reason || null, row.is_vip === true, row.entity_ref || null,
     row.first_message_at || new Date(), row.last_message_at || new Date()],
  ).then((r) => r.rows[0]);

/** Recount after an insert, so message_count is derived and cannot drift. */
const refreshThreadCounts = (client, threadId) =>
  client.query(
    `UPDATE email_thread t
        SET message_count  = agg.n,
            has_attachment = agg.att,
            last_message_at = agg.last,
            first_message_at = agg.first
       FROM (SELECT count(*)::int AS n, bool_or(has_attachment) AS att,
                    max(received_at) AS last, min(received_at) AS first
               FROM email_message WHERE email_thread_id = $1) agg
      WHERE t.email_thread_id = $1
      RETURNING t.message_count`,
    [threadId],
  ).then((r) => r.rows[0] || null);

/* ── Messages ─────────────────────────────────────────────────────────────── */

/** Dedup-insert. Returns null when the message was already stored. */
const insertMessage = (client, row) =>
  client.query(
    `INSERT INTO email_message
       (email_thread_id, email_connection_id, email_identity_id, external_message_id, message_id_header,
        direction, folder, provider_folder, from_address, from_name, to_address, cc_address,
        subject, body_html, body_text, body_preview, in_reply_to, references_header,
        size_bytes, has_attachment, sent_via, origin_user_id, origin_send_point, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     ON CONFLICT (email_connection_id, external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
     RETURNING email_message_id, email_thread_id`,
    [row.email_thread_id, row.email_connection_id, row.email_identity_id || null,
     row.external_message_id || null, row.message_id_header || null,
     row.direction || "IN", row.folder || "INBOX", row.provider_folder || null,
     row.from_address || "unknown@unknown", row.from_name || null,
     row.to_address || [], row.cc_address || [],
     row.subject || null, row.body_html || null, row.body_text || null,
     String(row.body_text || row.body_preview || "").slice(0, 500),
     row.in_reply_to || null, row.references_header || null,
     row.size_bytes || null, row.has_attachment === true,
     row.sent_via || null, row.origin_user_id || null, row.origin_send_point || null,
     row.received_at || new Date()],
  ).then((r) => r.rows[0] || null);

const getMessage = (client, userId, id) =>
  client.query(
    `SELECT m.*, m.to_address::text[] AS to_address, m.cc_address::text[] AS cc_address,
            m.bcc_address::text[] AS bcc_address,
            COALESCE(s.is_read,false) AS is_read, COALESCE(s.is_starred,false) AS is_starred
       FROM email_message m
       LEFT JOIN email_message_state s ON s.email_message_id = m.email_message_id AND s.user_id = $1
      WHERE m.email_message_id = $2 AND m.email_connection_id IN ${accessible(1)}`,
    [userId, id],
  ).then((r) => r.rows[0] || null);

const moveThread = (client, userId, threadId, folder) =>
  client.query(
    `UPDATE email_message m SET folder = $3
      WHERE m.email_thread_id = $2 AND m.email_connection_id IN ${accessible(1)}
      RETURNING m.email_message_id, m.external_message_id, m.provider_folder`,
    [userId, threadId, folder],
  ).then((r) => r.rows);

/* ── Per-user state ───────────────────────────────────────────────────────── */

/** Mark every message on a thread read (or unread) FOR THIS USER only. */
const setThreadRead = (client, userId, threadId, isRead = true) =>
  client.query(
    `INSERT INTO email_message_state (email_message_id, user_id, is_read, read_at)
     SELECT m.email_message_id, $1, $3, CASE WHEN $3 THEN now() ELSE NULL END
       FROM email_message m
      WHERE m.email_thread_id = $2 AND m.email_connection_id IN ${accessible(1)}
     ON CONFLICT (email_message_id, user_id)
     DO UPDATE SET is_read = EXCLUDED.is_read, read_at = EXCLUDED.read_at
      RETURNING email_message_id`,
    [userId, threadId, isRead],
  ).then((r) => r.rows.length);

const setThreadStarred = (client, userId, threadId, isStarred = true) =>
  client.query(
    `INSERT INTO email_message_state (email_message_id, user_id, is_starred)
     SELECT m.email_message_id, $1, $3 FROM email_message m
      WHERE m.email_thread_id = $2 AND m.email_connection_id IN ${accessible(1)}
     ON CONFLICT (email_message_id, user_id) DO UPDATE SET is_starred = EXCLUDED.is_starred
      RETURNING email_message_id`,
    [userId, threadId, isStarred],
  ).then((r) => r.rows.length);

/** Seed unread state for a newly synced message, for everyone who can see it. */
const seedStateForMembers = (client, messageId, connectionId) =>
  client.query(
    `INSERT INTO email_message_state (email_message_id, user_id, is_read)
     SELECT $1, u.user_id, false FROM (
       SELECT c.owner_user_id AS user_id FROM email_connection c
        WHERE c.email_connection_id = $2 AND c.owner_user_id IS NOT NULL
       UNION
       SELECT m.user_id FROM email_connection_member m
        WHERE m.email_connection_id = $2 AND m.revoked_at IS NULL
     ) u
     ON CONFLICT (email_message_id, user_id) DO NOTHING`,
    [messageId, connectionId],
  );

/* ── Folders ──────────────────────────────────────────────────────────────── */

const listFolders = (client, connectionId, userId = null) =>
  client.query(
    // `unread_count`, spelled the same as in listThreads. The rail and the list
    // show the same number and the client should not have to remember which
    // endpoint calls it what.
    //
    // Ordered by the product's own sequence, not alphabetically: a rail that
    // opens with Archive, Drafts, Inbox is sorted correctly and reads wrongly.
    // The user's own folders follow, alphabetically, after the canonical six.
    `SELECT f.*,
            (SELECT count(*) FROM email_message m
              WHERE m.email_connection_id = f.email_connection_id AND m.folder = f.canonical)::int AS total,
            (SELECT count(*) FROM email_message m
              WHERE m.email_connection_id = f.email_connection_id AND m.folder = f.canonical
                AND NOT EXISTS (SELECT 1 FROM email_message_state s
                                 WHERE s.email_message_id = m.email_message_id AND s.user_id = $2 AND s.is_read))::int AS unread_count
       FROM email_folder f
      WHERE f.email_connection_id = $1
      ORDER BY COALESCE(array_position(ARRAY['INBOX','SENT','DRAFTS','ARCHIVE','SPAM','TRASH'], f.canonical), 99),
               f.display_name, f.provider_path`,
    [connectionId, userId],
  ).then((r) => r.rows);

/**
 * Unread conversations per stream, for the rail's People / Notices counts.
 *
 * A conversation counts as unread if ANY message in it is unread for this user
 * — the same rule the list's `unread_count` uses, so the rail and the list can
 * never disagree. Counted here rather than derived in the client, because the
 * client only holds one page of rows and a badge computed from a page is a
 * badge that quietly stops at fifty.
 */
const streamUnread = (client, userId, connectionId = null) =>
  client.query(
    `SELECT t.stream, count(*)::int AS unread
       FROM email_thread t
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.email_connection_id IN ${accessible(1)}
        AND ${vis(1)}
        AND ($2::uuid IS NULL OR t.email_connection_id = $2)
        AND EXISTS (SELECT 1 FROM email_message m
                     WHERE m.email_thread_id = t.email_thread_id
                       AND NOT EXISTS (SELECT 1 FROM email_message_state s
                                        WHERE s.email_message_id = m.email_message_id
                                          AND s.user_id = $1 AND s.is_read))
      GROUP BY t.stream`,
    [userId, connectionId],
  ).then((r) => {
    const out = { HUMAN: 0, SYSTEM: 0 };
    for (const row of r.rows) out[row.stream] = row.unread;
    return out;
  });

const upsertFolder = (client, connectionId, row) =>
  client.query(
    `INSERT INTO email_folder (email_connection_id, canonical, provider_path, display_name, is_syncable)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email_connection_id, provider_path) DO UPDATE
        SET canonical = COALESCE(email_folder.canonical, EXCLUDED.canonical),
            display_name = EXCLUDED.display_name
      RETURNING *`,
    [connectionId, row.canonical || null, row.provider_path, row.display_name || null, row.is_syncable === true],
  ).then((r) => r.rows[0]);

/**
 * Guarantee a row for a canonical folder, whether or not the server has one.
 *
 * A user can move mail to Archive on a mailbox whose server advertises no
 * Archive folder — the move is ours to record either way. Without a row the
 * messages land in a folder the rail cannot draw, which reads to the user as
 * "the mail is gone". `is_syncable` stays false: there is nothing on the server
 * to pull from, and marking it syncable would have the loop fetch a path that
 * does not exist.
 *
 * Keyed on the canonical role rather than the path, because that is the thing
 * being guaranteed. If discovery later finds a real server folder for the role,
 * upsertFolder claims it and this row is the one it updates.
 */
const ensureCanonicalFolder = (client, connectionId, canonical) =>
  client.query(
    `INSERT INTO email_folder (email_connection_id, canonical, provider_path, display_name, is_syncable)
     VALUES ($1, $2, $2, initcap(lower($2)), false)
     ON CONFLICT (email_connection_id, canonical) WHERE canonical IS NOT NULL
       DO UPDATE SET updated_at = now()
     RETURNING *`,
    [connectionId, canonical],
  ).then((r) => r.rows[0]);

const syncableFolders = (client, connectionId) =>
  client.query(
    "SELECT * FROM email_folder WHERE email_connection_id = $1 AND is_syncable ORDER BY (canonical <> 'INBOX'), canonical",
    [connectionId],
  ).then((r) => r.rows);

const setFolderCursor = (client, folderId, cursor) =>
  client.query(
    "UPDATE email_folder SET sync_cursor = $2, last_sync_at = now(), last_error = NULL WHERE email_folder_id = $1",
    [folderId, cursor || null],
  );

const setFolderError = (client, folderId, message) =>
  client.query(
    "UPDATE email_folder SET last_error = $2, last_sync_at = now() WHERE email_folder_id = $1",
    [folderId, String(message || "").slice(0, 500)],
  );

/* ── Labels ───────────────────────────────────────────────────────────────── */

const listLabels = (client, userId) =>
  client.query(
    `SELECT l.*, (SELECT count(*) FROM email_thread_label tl WHERE tl.email_label_id = l.email_label_id)::int AS thread_count
       FROM email_label l WHERE l.owner_user_id = $1 ORDER BY l.name`,
    [userId],
  ).then((r) => r.rows);

const createLabel = (client, userId, { name, colour }) =>
  client.query(
    `INSERT INTO email_label (owner_user_id, name, colour) VALUES ($1,$2,$3)
     ON CONFLICT (owner_user_id, name) DO UPDATE SET colour = EXCLUDED.colour RETURNING *`,
    [userId, name, colour || null],
  ).then((r) => r.rows[0]);

const deleteLabel = (client, userId, id) =>
  client.query("DELETE FROM email_label WHERE email_label_id = $1 AND owner_user_id = $2 RETURNING email_label_id", [id, userId])
    .then((r) => r.rows[0] || null);

const applyLabel = (client, userId, threadId, labelId, on = true) =>
  on
    ? client.query(
        `INSERT INTO email_thread_label (email_thread_id, email_label_id)
         SELECT $2, $3 WHERE EXISTS (SELECT 1 FROM email_label WHERE email_label_id = $3 AND owner_user_id = $1)
           AND EXISTS (SELECT 1 FROM email_thread t
                        JOIN email_connection c ON c.email_connection_id = t.email_connection_id
                       WHERE t.email_thread_id = $2 AND t.email_connection_id IN ${accessible(1)}
                         AND ${vis(1)})
         ON CONFLICT DO NOTHING RETURNING email_thread_id`,
        [userId, threadId, labelId],
      ).then((r) => r.rows.length > 0)
    : client.query(
        `DELETE FROM email_thread_label tl USING email_label l
          WHERE tl.email_label_id = l.email_label_id AND l.owner_user_id = $1
            AND tl.email_thread_id = $2 AND tl.email_label_id = $3 RETURNING tl.email_thread_id`,
        [userId, threadId, labelId],
      ).then((r) => r.rows.length > 0);

/* ── Classification inputs ────────────────────────────────────────────────── */

const streamRules = (client) =>
  client.query("SELECT * FROM email_stream_rule WHERE is_active ORDER BY priority, email_stream_rule_id")
    .then((r) => r.rows);

/**
 * Does this sender belong to somebody we know? The override that keeps a client's
 * mail out of the System stream, and the VIP flag in one lookup.
 */
const knownParty = (client, address) => {
  // LOWERCASED ON BOTH SIDES, and this is not a nicety.
  //
  // The address arrives exactly as the sender's client wrote it in the header —
  // `Client@Maersk.CM` is a perfectly ordinary From line — while the CRM row was
  // typed by whoever created the record. A case-sensitive `=` therefore fails on
  // real mail from real clients, and the failure is invisible: the override does
  // not fire, the message is classified on its headers alone, and a client's
  // correspondence quietly lands in the stream nobody watches. That is precisely
  // the outcome stream.js exists to prevent.
  //
  // Matched by the functional indexes in migration 10736, so this stays an index
  // scan rather than reading four tables per new conversation.
  if (!address) return Promise.resolve(null);
  const addr = String(address).trim().toLowerCase();
  if (!addr) return Promise.resolve(null);
  return client.query(
    `SELECT 'CLIENT' AS kind, name, is_vip FROM client_master   WHERE lower(email) = $1 AND is_active
     UNION ALL
     SELECT 'SUPPLIER', name, is_vip FROM supplier_master WHERE lower(email) = $1 AND is_active
     UNION ALL
     SELECT 'EMPLOYEE', full_name, false FROM employee     WHERE lower(email) = $1 AND is_active
     UNION ALL
     SELECT 'LEAD', COALESCE(contact_name, company_name), false FROM lead WHERE lower(email) = $1
     LIMIT 1`,
    [addr],
  ).then((r) => r.rows[0] || null);
};

/**
 * All mail on an entity, newest first — the CRM timeline.
 *
 * `userId` is REQUIRED and is not optional politeness: this is the read path
 * that shows a client's correspondence on a screen outside the mailbox, so it
 * is the easiest place in the product to see a thread you were never meant to.
 * It carries both predicates — the mailboxes the caller may open, and the
 * per-thread visibility inside them (§9.10 criterion 7 names the timeline
 * explicitly). A caller with no user id gets nothing rather than everything.
 */
const timelineByEntity = (client, entityRef, { limit = 100, userId = null } = {}) => {
  if (!userId) return Promise.resolve([]);
  return client.query(
    `SELECT m.email_message_id, m.email_connection_id, t.thread_key, m.direction, m.from_address,
            array_to_string(m.to_address::text[], ', ') AS to_address, m.subject, m.body_preview,
            t.entity_ref, m.received_at, m.sent_via
       FROM email_message m
       JOIN email_thread t ON t.email_thread_id = m.email_thread_id
       JOIN email_connection c ON c.email_connection_id = t.email_connection_id
      WHERE t.entity_ref = $1
        AND t.email_connection_id IN ${accessible(3)}
        AND ${vis(3)}
      ORDER BY m.received_at DESC LIMIT $2`,
    [entityRef, Math.min(Math.max(Number(limit) || 100, 1), 500), userId],
  ).then((r) => r.rows);
};

module.exports = {
  accessible,
  listThreads, getThread, getThreadUnrestricted, getThreadById, updateThread, upsertThread, refreshThreadCounts,
  insertMessage, getMessage, moveThread,
  setThreadRead, setThreadStarred, seedStateForMembers,
  listFolders, streamUnread, upsertFolder, ensureCanonicalFolder, syncableFolders, setFolderCursor, setFolderError,
  listLabels, createLabel, deleteLabel, applyLabel,
  streamRules, knownParty, timelineByEntity,
};
