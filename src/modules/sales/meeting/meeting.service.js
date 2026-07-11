/** Meeting management (MOD-21) — schedule, notes/minutes, optional Whisper
 *  transcript link (transcript_vault_id, from the ai-transcribe worker). SQL in repo. */
"use strict";
const repo = require("./meeting.repo");
const events = require("./meeting.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "meeting:" + id;
async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, { subject: data.subject, lead_id: data.lead_id || null, client_id: data.client_id || null, scheduled_at: data.scheduled_at || null, organiser_id: data.organiser_id || actor.user_id || null, transcript_vault_id: data.transcript_vault_id || null });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.meeting_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.meeting_id), after: row });
  return row;
}
async function addNote(client, { meetingId, body, isMinutes = false, actor = {} }) {
  const m = await repo.get(client, meetingId);
  if (!m) throw new AppError("NOT_FOUND", "Meeting not found", 404);
  const note = await repo.insertNote(client, { meeting_id: meetingId, author_id: actor.user_id || null, body, is_minutes: isMinutes === true });
  await audit(client, { actorUserId: actor.user_id || null, action: events.NOTE_ADDED, moduleKey: events.MODULE, entityRef: ref(meetingId), after: { note_id: note.meeting_note_id } });
  return note;
}
async function get(client, id) { const m = await repo.get(client, id); if (!m) return null; m.notes = await repo.listNotes(client, id); return m; }
const list = (client, q) => repo.list(client, q);
module.exports = { create, addNote, get, list };
