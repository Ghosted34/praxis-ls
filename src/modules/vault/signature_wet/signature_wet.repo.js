/** SQL for wet-signature print jobs and ingest queue (MOD-64). */
"use strict";

const { insertOne, listComplete } = require("../../../shared/db/query-helpers");

const JOB_COLS = "print_job_id, request_id, party_id, entity_ref, doc_type, document_vault_id, content_hash, print_code, reprint_of, reprint_no, status, printed_at, reconciled_at, reconciled_by, scan_vault_id, created_at, updated_at";
const INGEST_COLS = "ingest_id, source, source_ref, document_vault_id, decoded_code, decode_status, print_job_id, match_status, match_notes, processed_at, created_at, updated_at";

const insertJob = (client, data) => insertOne(client, "signature_print_job", data);
const insertIngest = (client, data) => insertOne(client, "signature_ingest", data);

async function getJob(client, id) {
  const { rows } = await client.query(`SELECT ${JOB_COLS} FROM signature_print_job WHERE print_job_id = $1`, [id]);
  return rows[0] || null;
}

async function getJobByCode(client, code) {
  const { rows } = await client.query(`SELECT ${JOB_COLS} FROM signature_print_job WHERE print_code = $1`, [code]);
  return rows[0] || null;
}

async function openJobForParty(client, partyId) {
  if (!partyId) return null;
  const { rows } = await client.query(
    `SELECT ${JOB_COLS} FROM signature_print_job
      WHERE party_id = $1 AND status IN ('ISSUED','PRINTED','REVIEW')
      ORDER BY created_at DESC LIMIT 1`,
    [partyId],
  );
  return rows[0] || null;
}

async function latestReprintNo(client, rootId) {
  const { rows } = await client.query(
    "SELECT COALESCE(max(reprint_no), 0)::int AS n FROM signature_print_job WHERE print_job_id = $1 OR reprint_of = $1",
    [rootId],
  );
  return rows[0].n;
}

async function markPrinted(client, id) {
  const { rows } = await client.query(
    `UPDATE signature_print_job
        SET status = CASE WHEN status = 'ISSUED' THEN 'PRINTED' ELSE status END,
            printed_at = COALESCE(printed_at, now()), updated_at = now()
      WHERE print_job_id = $1
      RETURNING ${JOB_COLS}`,
    [id],
  );
  return rows[0] || null;
}

async function transitionJob(client, id, status, extra = {}) {
  const fields = ["status = $2", "updated_at = now()"];
  const values = [id, status];
  if (extra.scan_vault_id !== undefined) { values.push(extra.scan_vault_id); fields.push(`scan_vault_id = $${values.length}`); }
  if (extra.reconciled_by !== undefined) { values.push(extra.reconciled_by); fields.push(`reconciled_by = $${values.length}`); }
  if (status === "RECONCILED") fields.push("reconciled_at = COALESCE(reconciled_at, now())");
  const { rows } = await client.query(
    `UPDATE signature_print_job SET ${fields.join(", ")} WHERE print_job_id = $1 RETURNING ${JOB_COLS}`,
    values,
  );
  return rows[0] || null;
}

async function findSignatureForJob(client, jobId) {
  const { rows } = await client.query(
    "SELECT signature_id FROM document_signature WHERE assurance_level = 'WET' AND visual_mark = 'INK' AND signature_request_id = (SELECT request_id FROM signature_print_job WHERE print_job_id = $1) AND document_vault_id = (SELECT scan_vault_id FROM signature_print_job WHERE print_job_id = $1) LIMIT 1",
    [jobId],
  );
  return rows[0] || null;
}

async function updateIngest(client, id, patch) {
  const allowed = ["decoded_code", "decode_status", "print_job_id", "match_status", "match_notes", "processed_at"];
  const sets = [];
  const values = [id];
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    values.push(patch[key]);
    sets.push(`${key} = $${values.length}`);
  }
  if (!sets.length) return getIngest(client, id);
  sets.push("updated_at = now()");
  const { rows } = await client.query(
    `UPDATE signature_ingest SET ${sets.join(", ")} WHERE ingest_id = $1 RETURNING ${INGEST_COLS}`,
    values,
  );
  return rows[0] || null;
}

async function getIngest(client, id) {
  const { rows } = await client.query(`SELECT ${INGEST_COLS} FROM signature_ingest WHERE ingest_id = $1`, [id]);
  return rows[0] || null;
}

async function listQueue(client, { limit = 100 } = {}) {
  const { rows } = await listComplete(
    client,
    `SELECT i.${INGEST_COLS.split(", ").join(", i.")}, j.entity_ref, j.doc_type, j.print_code
       FROM signature_ingest i
       LEFT JOIN signature_print_job j ON j.print_job_id = i.print_job_id
      WHERE i.match_status IN ('PENDING','REVIEW')
      ORDER BY i.created_at ASC`,
    [],
    { label: "Signature ingest queue", ceiling: Math.min(Number(limit) || 100, 500) },
  );
  return rows;
}

async function hasReconciledScan(client, jobId) {
  const { rows } = await client.query(
    "SELECT 1 FROM signature_print_job WHERE print_job_id = $1 AND status = 'RECONCILED' LIMIT 1",
    [jobId],
  );
  return Boolean(rows[0]);
}

async function unreconciled(client, days) {
  const { rows } = await client.query(
    `SELECT ${JOB_COLS}
       FROM signature_print_job
      WHERE status IN ('ISSUED','PRINTED')
        AND created_at < now() - ($1::int * interval '1 day')`,
    [days],
  );
  return rows;
}

module.exports = {
  insertJob, getJob, getJobByCode, openJobForParty, latestReprintNo, markPrinted, transitionJob,
  insertIngest, getIngest, updateIngest, listQueue, hasReconciledScan,
  findSignatureForJob, unreconciled,
};
