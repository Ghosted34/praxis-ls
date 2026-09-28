/**
 * The client chat (14170) — SQL.
 *
 * A THREAD is `client_message.dossier_id`: one per shipment, and NULL for the
 * General thread. Every read here is scoped to one client in SQL, so an id
 * guessed from another client's conversation returns nothing rather than
 * relying on a check somewhere above it.
 */
"use strict";

/** The thread key the cursors and the API speak: 'general' or the dossier id. */
const threadKey = (dossierId) => (dossierId ? String(dossierId) : "general");

/** A shipment that is this client's — with the owners a message about it alerts. */
async function clientDossier(client, { clientId, dossierId }) {
  const { rows } = await client.query(
    `SELECT d.dossier_id, d.ref, d.status, d.owner_ops_id, d.owner_sales_id
       FROM dossier_visible d
      WHERE d.dossier_id = $1 AND d.client_id = $2`,
    [dossierId, clientId],
  );
  return rows[0] || null;
}

/** A stage of that shipment the client can see — the only kind a message may name. */
async function clientMilestone(client, { dossierId, milestoneId }) {
  const { rows } = await client.query(
    `SELECT milestone_instance_id, label, label_en
       FROM milestone_instance
      WHERE milestone_instance_id = $1 AND dossier_id = $2 AND is_client_visible`,
    [milestoneId, dossierId],
  );
  return rows[0] || null;
}

/**
 * "Unread" for one person: newer than their cursor on that thread, and not
 * written by them. A colleague's message is news to me, as in any group chat.
 * With no cursor yet, only what arrived after their access began counts —
 * a person joining a company with three years of history does not open the
 * portal to "412 unread".
 */
const UNREAD = `
  NOT (m.direction = 'CLIENT' AND (m.portal_user_id IS NOT DISTINCT FROM $2::uuid
                                   OR lower(COALESCE(m.author_email::text, '')) = lower($3)))
  AND m.created_at > COALESCE(cur.last_read_at, $4::timestamptz)`;

/** Every thread this client has, newest activity first, with my unread count. */
async function threads(client, { clientId, portalUserId, email, since }) {
  const { rows } = await client.query(
    `WITH last AS (
       SELECT DISTINCT ON (m.dossier_id)
              m.dossier_id, m.message_id, m.body, m.direction, m.created_at,
              m.author_email, m.portal_user_id,
              (m.location_lat IS NOT NULL) AS has_location,
              (SELECT a.kind FROM client_message_attachment a
                WHERE a.message_id = m.message_id ORDER BY a.position LIMIT 1) AS attachment_kind
         FROM client_message m
        WHERE m.client_id = $1
        ORDER BY m.dossier_id, m.created_at DESC
     ), unread AS (
       SELECT m.dossier_id, COUNT(*)::int AS unread
         FROM client_message m
         LEFT JOIN client_message_cursor cur
                ON cur.client_id = m.client_id AND cur.portal_user_id = $2
               AND cur.thread_key = COALESCE(m.dossier_id::text, 'general')
        WHERE m.client_id = $1 AND ${UNREAD}
        GROUP BY m.dossier_id
     )
     SELECT l.*, COALESCE(u.unread, 0) AS unread, d.ref AS dossier_ref, d.status AS dossier_status
       FROM last l
       LEFT JOIN unread u ON COALESCE(u.dossier_id::text, 'general') = COALESCE(l.dossier_id::text, 'general')
       LEFT JOIN dossier_visible d ON d.dossier_id = l.dossier_id
      ORDER BY l.created_at DESC`,
    [clientId, portalUserId, email || "", since || "epoch"],
  );
  return rows;
}

/** My unread total across the threads I can see — the badge on the chat button. */
async function unreadTotal(client, { clientId, portalUserId, email, since, shipments }) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM client_message m
       LEFT JOIN client_message_cursor cur
              ON cur.client_id = m.client_id AND cur.portal_user_id = $2
             AND cur.thread_key = COALESCE(m.dossier_id::text, 'general')
      WHERE m.client_id = $1 AND ${UNREAD}
        AND ($5::boolean OR m.dossier_id IS NULL)`,
    [clientId, portalUserId, email || "", since || "epoch", shipments === true],
  );
  return rows[0] ? rows[0].n : 0;
}

/**
 * One page of one thread — the newest `limit` older than `before`, handed back
 * oldest first — with each message's attachments, stage and author.
 * `clientView` hides a stage staff have since made internal.
 */
async function messages(client, { clientId, dossierId, before = null, limit = 40, clientView = true }) {
  const params = [clientId, before, limit];
  let thread = "m.dossier_id IS NULL";
  if (dossierId) {
    params.push(dossierId);
    thread = `m.dossier_id = $${params.length}`;
  }
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT m.message_id, m.client_id, m.dossier_id, m.direction, m.body,
              m.author_user_id, m.author_email, m.portal_user_id, m.created_at, m.staff_read_at,
              m.location_lat, m.location_lng, m.location_label,
              u.full_name AS author_name, d.ref AS dossier_ref,
              mi.milestone_instance_id, mi.label AS milestone_label, mi.label_en AS milestone_label_en,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'attachment_id', a.attachment_id, 'kind', a.kind, 'file_name', a.file_name,
                         'mime_type', a.mime_type, 'byte_size', a.byte_size, 'width', a.width,
                         'height', a.height, 'duration_ms', a.duration_ms) ORDER BY a.position)
                  FROM client_message_attachment a WHERE a.message_id = m.message_id
              ), '[]'::json) AS attachments
         FROM client_message m
         LEFT JOIN app_user u ON u.user_id = m.author_user_id
         LEFT JOIN dossier_visible d ON d.dossier_id = m.dossier_id
         LEFT JOIN milestone_instance mi
                ON mi.milestone_instance_id = m.milestone_instance_id
               ${clientView ? "AND mi.is_client_visible" : ""}
        WHERE m.client_id = $1 AND ${thread}
          AND ($2::timestamptz IS NULL OR m.created_at < $2::timestamptz)
        ORDER BY m.created_at DESC
        LIMIT $3
     ) page ORDER BY page.created_at ASC`,
    params,
  );
  return rows;
}

async function insertMessage(client, m) {
  const { rows } = await client.query(
    `INSERT INTO client_message
       (client_id, dossier_id, direction, body, author_user_id, author_email, portal_user_id,
        milestone_instance_id, location_lat, location_lng, location_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      m.clientId, m.dossierId || null, m.direction, m.body || "", m.authorUserId || null,
      m.authorEmail || null, m.portalUserId || null, m.milestoneId || null,
      m.location ? m.location.lat : null, m.location ? m.location.lng : null,
      m.location ? m.location.label || null : null,
    ],
  );
  return rows[0];
}

async function insertAttachment(client, a) {
  const { rows } = await client.query(
    `INSERT INTO client_message_attachment
       (message_id, doc_id, kind, file_name, mime_type, byte_size, width, height, duration_ms, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
     RETURNING *`,
    [a.messageId, a.docId, a.kind, a.fileName || null, a.mimeType || null, a.byteSize || null,
      a.width || null, a.height || null, a.durationMs || null],
  );
  return rows[0];
}

/** Move my cursor forward on one thread — never back (two tabs, two clocks). */
async function markRead(client, { clientId, portalUserId, dossierId, at = null }) {
  await client.query(
    `INSERT INTO client_message_cursor (client_id, portal_user_id, thread_key, last_read_at)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
     ON CONFLICT (client_id, portal_user_id, thread_key)
     DO UPDATE SET last_read_at = GREATEST(client_message_cursor.last_read_at, EXCLUDED.last_read_at)`,
    [clientId, portalUserId, threadKey(dossierId), at],
  );
}

/** The team has read a thread: the client's messages in it get their "seen". */
async function markStaffRead(client, { clientId, dossierId }) {
  const { rowCount } = await client.query(
    `UPDATE client_message m SET staff_read_at = now()
      WHERE m.client_id = $1 AND ${dossierId ? "m.dossier_id = $2" : "m.dossier_id IS NULL"}
        AND m.direction = 'CLIENT' AND m.staff_read_at IS NULL`,
    dossierId ? [clientId, dossierId] : [clientId],
  );
  return rowCount;
}

/** Threads for the team's side of one client: what is waiting for us in each. */
async function staffThreads(client, { clientId }) {
  const { rows } = await client.query(
    `SELECT m.dossier_id, d.ref AS dossier_ref,
            MAX(m.created_at) AS last_at,
            COUNT(*) FILTER (WHERE m.direction = 'CLIENT' AND m.staff_read_at IS NULL)::int AS unread
       FROM client_message m
       LEFT JOIN dossier_visible d ON d.dossier_id = m.dossier_id
      WHERE m.client_id = $1
      GROUP BY m.dossier_id, d.ref
      ORDER BY MAX(m.created_at) DESC`,
    [clientId],
  );
  return rows;
}

/** One attachment and the vault row behind it, if it belongs to this client. */
async function attachment(client, { attachmentId, clientId = null }) {
  const params = [attachmentId];
  let owner = "";
  if (clientId) {
    params.push(clientId);
    owner = "AND m.client_id = $2";
  }
  const { rows } = await client.query(
    `SELECT a.*, m.client_id, m.dossier_id, v.storage_path, v.original_name
       FROM client_message_attachment a
       JOIN client_message m ON m.message_id = a.message_id
       JOIN document_vault v ON v.doc_id = a.doc_id
      WHERE a.attachment_id = $1 ${owner}`,
    params,
  );
  return rows[0] || null;
}

/**
 * Who on the team a client's message alerts (owner decision 2/12), as three
 * lists the service combines:
 *
 *   manager  the client's account manager (client_master.
 *            relationship_manager_user_id, 14200) — if their login is ACTIVE;
 *   owners   for a shipment's conversation, that file's operations and sales
 *            owners — the ACTIVE ones;
 *   md       the MD — the CEO role (role.code = 'CEO', as auth derives
 *            is_ceo: app_user has no such column) — told of every one.
 *
 * Only active logins, everywhere: someone who has left is not a destination,
 * and counting them would stop the fallback to the inbox (which the service
 * applies when `manager` and `owners` are both empty).
 */
async function staffAudience(client, { clientId, dossier }) {
  const owners = dossier ? [dossier.owner_ops_id, dossier.owner_sales_id].filter(Boolean) : [];
  const { rows } = await client.query(
    `SELECT 'manager' AS why, u.user_id
       FROM client_master cm
       JOIN app_user u ON u.user_id = cm.relationship_manager_user_id
      WHERE cm.client_id = $1 AND u.status = 'ACTIVE'
     UNION ALL
     SELECT 'owner' AS why, u.user_id
       FROM app_user u
      WHERE u.user_id = ANY($2::uuid[]) AND u.status = 'ACTIVE'
     UNION ALL
     SELECT 'md' AS why, u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'`,
    [clientId, owners],
  );
  const of = (why) => [...new Set(rows.filter((r) => r.why === why).map((r) => r.user_id))];
  return { manager: of("manager"), owners: of("owner"), md: of("md") };
}

/**
 * The Client inbox (PR 3): one row per client and thread, those waiting for
 * an answer first, with who looks after the client and who owns the file — so
 * the service can offer All, Waiting and Mine from this one read.
 *
 * A conversation is listed when it moved in the last six months OR a client
 * message in it is still unread by the team, however old: the bound keeps the
 * list to what is current, and must never be what hides a question nobody
 * answered. An older, answered conversation is one click away on the client's
 * own Messages tab, and a new message brings it straight back.
 */
async function inbox(client, { limit = 300 } = {}) {
  const { rows } = await client.query(
    `WITH waiting AS (
       SELECT m.client_id, m.dossier_id, COUNT(*)::int AS unread, MIN(m.created_at) AS waiting_since
         FROM client_message m
        WHERE m.direction = 'CLIENT' AND m.staff_read_at IS NULL
        GROUP BY m.client_id, m.dossier_id
     ), last AS (
       SELECT DISTINCT ON (m.client_id, m.dossier_id)
              m.client_id, m.dossier_id, m.message_id, m.body, m.direction, m.created_at,
              (m.location_lat IS NOT NULL) AS has_location,
              (SELECT a.kind FROM client_message_attachment a
                WHERE a.message_id = m.message_id ORDER BY a.position LIMIT 1) AS attachment_kind
         FROM client_message m
        WHERE m.created_at > now() - interval '180 days'
           OR EXISTS (SELECT 1 FROM waiting w0
                       WHERE w0.client_id = m.client_id
                         AND COALESCE(w0.dossier_id::text, 'general') = COALESCE(m.dossier_id::text, 'general'))
        ORDER BY m.client_id, m.dossier_id, m.created_at DESC
     )
     SELECT l.*, COALESCE(w.unread, 0) AS unread, w.waiting_since,
            COALESCE(cm.name, cm.legal_name) AS client_name,
            d.ref AS dossier_ref, d.owner_ops_id, d.owner_sales_id,
            cm.relationship_manager_user_id AS manager_user_id,
            COALESCE(me.full_name, mu.full_name) AS manager_name
       FROM last l
       JOIN client_master cm ON cm.client_id = l.client_id
       LEFT JOIN waiting w
              ON w.client_id = l.client_id
             AND COALESCE(w.dossier_id::text, 'general') = COALESCE(l.dossier_id::text, 'general')
       LEFT JOIN dossier_visible d ON d.dossier_id = l.dossier_id
       LEFT JOIN app_user mu ON mu.user_id = cm.relationship_manager_user_id
       LEFT JOIN employee me ON me.employee_id = mu.employee_id
      ORDER BY (COALESCE(w.unread, 0) > 0) DESC, l.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  threadKey, clientDossier, clientMilestone, threads, unreadTotal, messages, insertMessage,
  insertAttachment, markRead, markStaffRead, staffThreads, attachment, staffAudience, inbox,
};
