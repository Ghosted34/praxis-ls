/** Meeting repository (MOD-21). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");
const { AppError } = require("../../../utils/errors");

const insert = (client, data) => insertOne(client, "meeting", data);
const get = (client, id) => getById(client, "meeting", "meeting_id", id);
const insertNote = (client, data) => insertOne(client, "meeting_note", data);

const MEETING_WRITABLE = ["subject", "lead_id", "client_id", "scheduled_at", "location", "organiser_id", "transcript_vault_id"];
async function update(client, id, fields = {}) {
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "meeting", "meeting_id", id, fields, "*", MEETING_WRITABLE);
}

async function listNotes(client, id) {
  return (await client.query("SELECT * FROM meeting_note WHERE meeting_id = $1 ORDER BY created_at", [id])).rows;
}

async function list(client, q = {}) {
  const { limit, offset } = page(q); const params = [limit, offset]; const wh = [];
  if (q.lead_id) { params.push(q.lead_id); wh.push("lead_id = $" + params.length); }
  if (q.client_id) { params.push(q.client_id); wh.push("client_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query("SELECT * FROM meeting " + where + " ORDER BY scheduled_at DESC NULLS LAST, created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}

/* ── Discovery sections ──────────────────────────────────────────────────── */

/**
 * The ONLY columns a section write may touch, asserted rather than filtered.
 *
 * `transcript_vault_id` is on this list because the ai-transcribe WORKER writes
 * it through this repo. It is kept off the request validator instead — which is
 * where the old "caller asserts its own transcript" defect actually lived. A
 * silent filter here would make the worker's write fail invisibly, which is the
 * failure mode this codebase already learned about in query-helpers.
 */
const SECTION_WRITABLE = new Set([
  "body", "capture_state", "dictation_job_id", "dictation_error",
  "transcript_vault_id", "audio_seconds", "updated_by",
]);

/**
 * Upsert one section. The section IS the identity — (meeting_id, section_key) is
 * unique — so saving twice updates rather than producing a second "pain points"
 * for one visit, and a double-submitted form is harmless.
 */
async function upsertSection(client, meetingId, sectionKey, fields = {}) {
  const keys = Object.keys(fields);
  const bad = keys.filter((k) => !SECTION_WRITABLE.has(k));
  if (bad.length) {
    throw new AppError("FIELD_NOT_WRITABLE", `${bad.map((b) => `"${b}"`).join(", ")} cannot be written on meeting_discovery_section`, 422);
  }
  const cols = ["meeting_id", "section_key", ...keys];
  const values = [meetingId, sectionKey, ...keys.map((k) => fields[k])];
  const placeholders = values.map((_, i) => "$" + (i + 1));
  const assignments = keys.map((k) => `"${k}" = EXCLUDED."${k}"`).concat(["updated_at = now()"]);
  const sql =
    `INSERT INTO meeting_discovery_section (${cols.map((c) => `"${c}"`).join(", ")})
     VALUES (${placeholders.join(", ")})
     ON CONFLICT (meeting_id, section_key) DO UPDATE SET ${assignments.join(", ")}
     RETURNING *`;
  return (await client.query(sql, values)).rows[0];
}

async function getSection(client, meetingId, sectionKey) {
  return (await client.query(
    "SELECT * FROM meeting_discovery_section WHERE meeting_id = $1 AND section_key = $2",
    [meetingId, sectionKey],
  )).rows[0] || null;
}

async function listSections(client, meetingId) {
  return (await client.query(
    "SELECT * FROM meeting_discovery_section WHERE meeting_id = $1 ORDER BY section_key",
    [meetingId],
  )).rows;
}

/**
 * The most recent meeting on a lead (or client) that actually HAS discovery
 * content, with its sections. One round trip, because F4 (proposal generation)
 * calls this on every draft and "fetch the meetings, then fetch each one's
 * sections" is the shape that turns into an N+1 the moment a prospect is
 * courted properly.
 *
 * `scheduled_at DESC NULLS LAST, created_at DESC` matches ix_meeting_lead_recent
 * and the list order, so "the latest" means the same thing on both screens.
 */
async function latestDiscovery(client, { leadId = null, clientId = null }) {
  const column = leadId ? "lead_id" : "client_id";
  const id = leadId || clientId;
  const { rows } = await client.query(
    `SELECT m.meeting_id, m.subject, m.scheduled_at, m.location, m.lead_id, m.client_id,
            m.transcript_vault_id,
            COALESCE(
              json_agg(s.* ORDER BY s.section_key) FILTER (WHERE s.meeting_discovery_section_id IS NOT NULL),
              '[]'::json
            ) AS sections
       FROM meeting m
       JOIN meeting_discovery_section s ON s.meeting_id = m.meeting_id
      WHERE m.${column} = $1
        AND COALESCE(BTRIM(s.body), '') <> ''
      GROUP BY m.meeting_id
      ORDER BY m.scheduled_at DESC NULLS LAST, m.created_at DESC
      LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

/* ── Probing-question catalogue ──────────────────────────────────────────── */

async function listPrompts(client, { sectionKey = null, includeInactive = false } = {}) {
  const params = []; const wh = [];
  if (sectionKey) { params.push(sectionKey); wh.push("section_key = $" + params.length); }
  if (!includeInactive) wh.push("is_active");
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  return (await client.query(
    `SELECT * FROM meeting_discovery_prompt ${where} ORDER BY section_key, sort_order, created_at`,
    params,
  )).rows;
}

const getPrompt = (client, id) => getById(client, "meeting_discovery_prompt", "meeting_discovery_prompt_id", id);
const insertPrompt = (client, data) => insertOne(client, "meeting_discovery_prompt", data);

const PROMPT_WRITABLE = ["prompt_en", "prompt_fr", "sort_order", "is_active"];
async function updatePrompt(client, id, fields = {}) {
  if (!Object.keys(fields).length) return getPrompt(client, id);
  return updateOne(client, "meeting_discovery_prompt", "meeting_discovery_prompt_id", id, fields, "*", PROMPT_WRITABLE, { touch: "updated_at" });
}

module.exports = {
  insert, get, update, insertNote, listNotes, list,
  upsertSection, getSection, listSections, latestDiscovery,
  listPrompts, getPrompt, insertPrompt, updatePrompt,
};
