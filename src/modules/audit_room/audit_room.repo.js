/** Auditor data-room repository (table `auditor_data_room`, migration 10704). */
"use strict";

/** A room with its shared-document count, newest first. */
async function listForEmail(client, email) {
  const { rows } = await client.query(
    `SELECT r.*, count(d.doc_id)::int AS doc_count
       FROM auditor_data_room r
       LEFT JOIN auditor_data_room_doc d ON d.room_id = r.room_id
      WHERE r.subject_email = $1
      GROUP BY r.room_id
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [email],
  );
  return rows;
}

/** All rooms (staff view), newest first. */
async function listForStaff(client) {
  const { rows } = await client.query(
    `SELECT r.*, count(d.doc_id)::int AS doc_count
       FROM auditor_data_room r
       LEFT JOIN auditor_data_room_doc d ON d.room_id = r.room_id
      GROUP BY r.room_id
      ORDER BY r.created_at DESC
      LIMIT 200`,
  );
  return rows;
}

async function insert(client, data) {
  const { rows } = await client.query(
    `INSERT INTO auditor_data_room (subject_email, request_note)
     VALUES ($1, $2) RETURNING *`,
    [data.subjectEmail, data.requestNote],
  );
  return rows[0];
}

async function get(client, roomId) {
  const { rows } = await client.query(
    "SELECT * FROM auditor_data_room WHERE room_id = $1",
    [roomId],
  );
  return rows[0] || null;
}

/** A room's shared documents, joined to their registry names. */
async function docs(client, roomId) {
  const { rows } = await client.query(
    `SELECT v.doc_id, v.doc_type, v.original_name, v.created_at,
            dr.name_en, dr.name_fr, dr.code AS doc_type_code
       FROM auditor_data_room_doc ad
       JOIN document_vault v ON v.doc_id = ad.doc_id
       LEFT JOIN dictionary_ref dr ON dr.ref_id = v.doc_type_ref_id
      WHERE ad.room_id = $1
      ORDER BY ad.added_at ASC`,
    [roomId],
  );
  return rows;
}

/** Attach a vault document to a room. No-op when already attached. */
async function attachDoc(client, { roomId, docId, addedBy }) {
  const { rows } = await client.query(
    `INSERT INTO auditor_data_room_doc (room_id, doc_id, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (room_id, doc_id) DO NOTHING
     RETURNING *`,
    [roomId, docId, addedBy],
  );
  return rows[0] || null;
}

async function markAnswered(client, { roomId, answeredBy }) {
  const { rows } = await client.query(
    `UPDATE auditor_data_room
        SET status = 'ANSWERED', answered_at = now(), answered_by = $2
      WHERE room_id = $1 AND status = 'OPEN'
      RETURNING *`,
    [roomId, answeredBy],
  );
  return rows[0] || null;
}

module.exports = {
  listForEmail, listForStaff, insert, get, docs, attachDoc, markAnswered,
};
