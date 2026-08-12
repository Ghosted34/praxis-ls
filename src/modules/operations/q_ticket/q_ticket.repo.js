/** Q-ticket repository (table `q_ticket`, migration 0310). */
"use strict";
const { insertOne, getById, page } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "q_ticket", data);
const get = (client, id) => getById(client, "q_ticket", "q_ticket_id", id);

/**
 * Tickets with the milestone they were raised against, so a queue row reads as
 * "SLAS-2026-0041 · Customs clearance · Why is this still pending?" rather than
 * a subject line with no context.
 */
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dossier_id) { params.push(q.dossier_id); wh.push("t.dossier_id = $" + params.length); }
  if (q.status) { params.push(q.status); wh.push("t.status = $" + params.length); }
  // The queue's default is "what still needs us" — a resolved ticket is history.
  if (!q.status && !q.include_resolved) wh.push("t.status <> 'RESOLVED'");

  const { rows } = await client.query(
    "SELECT t.*, d.ref AS dossier_ref, mi.label AS milestone_label, mi.code AS milestone_code " +
      "  FROM q_ticket t " +
      "  LEFT JOIN dossier d ON d.dossier_id = t.dossier_id " +
      "  LEFT JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id " +
      (wh.length ? " WHERE " + wh.join(" AND ") : "") +
      " ORDER BY t.created_at DESC LIMIT $1 OFFSET $2",
    params,
  );
  return rows;
}

/** A ticket's thread, oldest first — the conversation, not just the question. */
async function replies(client, ticketId) {
  const { rows } = await client.query(
    "SELECT * FROM q_ticket_reply WHERE q_ticket_id = $1 ORDER BY created_at ASC",
    [ticketId],
  );
  return rows;
}

const insertReply = (client, data) => insertOne(client, "q_ticket_reply", data);

async function setStatus(client, id, status) {
  const { rows } = await client.query(
    "UPDATE q_ticket SET status = $2 WHERE q_ticket_id = $1 RETURNING *",
    [id, status],
  );
  return rows[0] || null;
}

/** Scoped to the client's own files — the portal must never widen this. */
async function listForClient(client, clientId) {
  const { rows } = await client.query(
    "SELECT t.q_ticket_id, t.subject, t.body, t.status, t.created_at, d.ref AS dossier_ref, mi.label AS milestone_label " +
      "  FROM q_ticket t JOIN dossier d ON d.dossier_id = t.dossier_id " +
      "  LEFT JOIN milestone_instance mi ON mi.milestone_instance_id = t.milestone_instance_id " +
      " WHERE d.client_id = $1 ORDER BY t.created_at DESC LIMIT 100",
    [clientId],
  );
  return rows;
}

/** Does this dossier belong to this client? The portal's only authorisation. */
async function dossierBelongsTo(client, { dossierId, clientId }) {
  const { rows } = await client.query(
    "SELECT 1 FROM dossier WHERE dossier_id = $1 AND client_id = $2",
    [dossierId, clientId],
  );
  return rows.length > 0;
}

module.exports = { insert, get, list, replies, insertReply, setStatus, listForClient, dossierBelongsTo };
