/**
 * Meeting management (MOD-21) — scheduling, notes/minutes, and the Client
 * Discovery Framework: three named sections captured against a lead, typed or
 * dictated, which are the raw material a proposal is later drafted from.
 *
 * TWO THINGS TO KNOW BEFORE CHANGING THIS FILE.
 *
 * 1. `transcript_vault_id` is NOT settable by a caller. It used to be read
 *    straight off the request body here, while nothing in the system enqueued a
 *    transcription at all — so the field was the client telling the server what
 *    the server had supposedly produced. It is now written in exactly one place,
 *    `applyTranscript`, which only the ai-transcribe worker calls.
 *
 * 2. Dictation is ASYNCHRONOUS and can fail. `startDictation` puts the section
 *    into DICTATING and returns; the worker lands the text or marks
 *    TRANSCRIPTION_FAILED. Nothing here waits on a model, and no path leaves a
 *    section that had audio looking like a section nobody filled in.
 *
 * All SQL is in the repo; the framework's vocabulary and text rules are in
 * meeting.rules.js.
 */
"use strict";
const repo = require("./meeting.repo");
const events = require("./meeting.events");
const rules = require("./meeting.rules");
const vault = require("../../vault/document_vault/document_vault.service");
const { enqueue } = require("../../../jobs/queue-producer");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "meeting:" + id;
const sectionRef = (id, key) => `meeting:${id}#${key}`;

async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, {
    subject: data.subject,
    lead_id: data.lead_id || null,
    client_id: data.client_id || null,
    scheduled_at: data.scheduled_at || null,
    // The legacy discovery wizard asks for it (meetLocation) and this schema had
    // nowhere to put it, so it was being lost at the point of capture.
    location: data.location || null,
    organiser_id: data.organiser_id || actor.user_id || null,
  });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.meeting_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.meeting_id), after: row });
  return row;
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Meeting not found", 404);
  const fields = {};
  for (const k of ["subject", "lead_id", "client_id", "scheduled_at", "location", "organiser_id"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function addNote(client, { meetingId, body, isMinutes = false, actor = {} }) {
  const m = await repo.get(client, meetingId);
  if (!m) throw new AppError("NOT_FOUND", "Meeting not found", 404);
  const note = await repo.insertNote(client, {
    meeting_id: meetingId, author_id: await resolveActorId(client, actor.user_id), body, is_minutes: isMinutes === true,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.NOTE_ADDED, moduleKey: events.MODULE, entityRef: ref(meetingId), after: { note_id: note.meeting_note_id } });
  return note;
}

/* ── Discovery capture ───────────────────────────────────────────────────── */

async function mustGetMeeting(client, id) {
  const m = await repo.get(client, id);
  if (!m) throw new AppError("NOT_FOUND", "Meeting not found", 404);
  return m;
}

/** The framework as it stands for one meeting: all three sections (present or
 *  not) plus the probing questions to print above each. */
async function discovery(client, meetingId) {
  const m = await mustGetMeeting(client, meetingId);
  const [rows, prompts] = await Promise.all([repo.listSections(client, meetingId), repo.listPrompts(client, {})]);
  return {
    meeting_id: m.meeting_id,
    subject: m.subject,
    scheduled_at: m.scheduled_at,
    location: m.location,
    lead_id: m.lead_id,
    client_id: m.client_id,
    sections: rules.mergeSet(rows, meetingId).map((s) => ({
      ...s,
      ...(rules.SECTIONS.find((d) => d.key === s.section_key) || {}),
      prompts: prompts.filter((p) => p.section_key === s.section_key),
    })),
  };
}

/** Save one section's text. Upsert — the section is its own identity. */
async function saveSection(client, { meetingId, sectionKey, body, actor = {} }) {
  await mustGetMeeting(client, meetingId);
  rules.assertSection(sectionKey);
  const before = await repo.getSection(client, meetingId, sectionKey);
  const row = await repo.upsertSection(client, meetingId, sectionKey, {
    body: body ?? null,
    capture_state: rules.stateForBody(body),
    // Typing over a section that failed to transcribe clears the failure: the
    // person has just answered the question by hand, which is the resolution.
    dictation_error: null,
    updated_by: await resolveActorId(client, actor.user_id),
  });
  await emitEvent(client, { eventTypeKey: events.DISCOVERY_CAPTURED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.DISCOVERY_CAPTURED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), before, after: row });
  return row;
}

/**
 * "The latest discovery set for a lead", in one call — the read F4 makes before
 * drafting a proposal. Returns null when the lead has been met but never
 * written up, which the caller must treat as "no discovery", not as an error.
 */
async function latestDiscoveryFor(client, { leadId = null, clientId = null }) {
  if (!leadId && !clientId) throw new AppError("VALIDATION_ERROR", "A lead_id or a client_id is required", 422);
  const row = await repo.latestDiscovery(client, { leadId, clientId });
  if (!row) return null;
  const sections = rules.mergeSet(row.sections || [], row.meeting_id).map((s) => ({
    ...s, ...(rules.SECTIONS.find((d) => d.key === s.section_key) || {}),
  }));
  return { ...row, sections, has_content: rules.hasContent(sections) };
}

/* ── Dictation ───────────────────────────────────────────────────────────── */

/**
 * A data URL WITH ITS PARAMETERS. MediaRecorder produces
 * "data:audio/webm;codecs=opus;base64,…", so a pattern that stops at the first
 * semicolon rejects every recording a browser actually makes. The media type is
 * the first token of the capture; the rest are parameters, and are ignored.
 */
const DATA_URL = /^data:([^,]*);base64,(.+)$/s;

/**
 * Accept audio for one section and hand it to the ai-transcribe worker.
 *
 * Returns 202-shaped data: the job id and the section, now DICTATING. The
 * governance gate (`voice` feature, per-user grant, tenant budget, plan spend
 * limit) is applied by the worker, which is where every other AI entry point
 * applies it — a second gate here would be a second thing to forget.
 */
async function startDictation(client, { meetingId, sectionKey, audioDataUrl, tenantMeta, env = "live", actor = {} }) {
  await mustGetMeeting(client, meetingId);
  rules.assertSection(sectionKey);
  const m = DATA_URL.exec(String(audioDataUrl || ""));
  if (!m) throw new AppError("BAD_AUDIO", "Expected a base64 audio data URL", 400);
  const mimeType = m[1].toLowerCase().split(";")[0].trim();
  if (!rules.AUDIO_MIME.includes(mimeType)) {
    throw new AppError("BAD_AUDIO_TYPE", `Only ${rules.AUDIO_MIME.join(", ")} are accepted`, 422);
  }
  const audioBase64 = m[2];
  // Measured on the DECODED bytes, not the base64 string, so the limit means
  // what a person would think it means.
  const bytes = Math.floor((audioBase64.length * 3) / 4);
  if (!bytes) throw new AppError("EMPTY_AUDIO", "The recording is empty", 422);
  if (bytes > rules.MAX_AUDIO_BYTES) {
    throw new AppError("AUDIO_TOO_LARGE", `Recording exceeds ${Math.round(rules.MAX_AUDIO_BYTES / (1024 * 1024))} MB`, 413);
  }

  await client.query("BEGIN");
  try {
    const marked = await repo.upsertSection(client, meetingId, sectionKey, {
      capture_state: "DICTATING",
      dictation_error: null,
      updated_by: await resolveActorId(client, actor.user_id),
    });
    const job = await enqueue("ai-transcribe", "meeting-discovery", {
      tenantMeta, env,
      user: { user_id: actor.user_id || null },
      audioBase64, mimeType,
      // The presence of `target` is what tells the handler this transcript
      // belongs to a record rather than to a copilot conversation.
      target: { kind: "meeting_discovery_section", meeting_id: meetingId, section_key: sectionKey },
    });
    const row = await repo.upsertSection(client, meetingId, sectionKey, { dictation_job_id: String(job.id) });
    await emitEvent(client, { eventTypeKey: events.DICTATION_QUEUED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DICTATION_QUEUED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), before: marked, after: { job_id: String(job.id), audio_bytes: bytes, mime_type: mimeType } });
    await client.query("COMMIT");
    return { job_id: String(job.id), section: row };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * The worker's landing point. Vaults the transcript, appends it to the section
 * and stamps the reference — in that order, inside one transaction, so a
 * section never claims a transcript document that does not exist.
 */
async function applyTranscript(client, { meetingId, sectionKey, text, audioSeconds = null, slug, actor = {} }) {
  const meeting = await mustGetMeeting(client, meetingId);
  rules.assertSection(sectionKey);
  const before = await repo.getSection(client, meetingId, sectionKey);
  const clean = String(text || "").trim();
  if (!clean) {
    // The provider answered, with nothing. That is a failed dictation, not a
    // successful empty one — say so rather than leaving the box blank.
    return failDictation(client, { meetingId, sectionKey, reason: "The recording came back with no speech in it", actor });
  }

  await client.query("BEGIN");
  try {
    const doc = await vault.createDocument(client, {
      entityRef: sectionRef(meetingId, sectionKey),
      docType: "MEETING_TRANSCRIPT",
      dataUrl: "data:text/plain;base64," + Buffer.from(clean, "utf8").toString("base64"),
      fileContext: `Discovery dictation — ${sectionKey}`,
      originalName: `discovery-${String(sectionKey).toLowerCase()}-${Date.now()}.txt`,
      slug, actor,
    });
    const row = await repo.upsertSection(client, meetingId, sectionKey, {
      body: rules.appendTranscript(before && before.body, clean),
      capture_state: "TRANSCRIBED",
      dictation_error: null,
      transcript_vault_id: doc.doc_id,
      audio_seconds: audioSeconds,
      updated_by: await resolveActorId(client, actor.user_id),
    });
    // The meeting-level column from 0350 keeps a defined meaning: the latest
    // transcript captured on this meeting. Written HERE, by the worker's path,
    // and nowhere else.
    if (meeting.transcript_vault_id !== doc.doc_id) {
      await repo.update(client, meetingId, { transcript_vault_id: doc.doc_id });
    }
    await emitEvent(client, { eventTypeKey: events.DICTATION_TRANSCRIBED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.DICTATION_TRANSCRIBED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), before, after: { transcript_vault_id: doc.doc_id, audio_seconds: audioSeconds } });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Mark a dictation as failed, VISIBLY. Called by the worker on a governance
 * refusal or a provider error. Deliberately does not clear the body — a section
 * that already had typed text keeps it and gains the failure notice.
 */
async function failDictation(client, { meetingId, sectionKey, reason, actor = {} }) {
  rules.assertSection(sectionKey);
  const row = await repo.upsertSection(client, meetingId, sectionKey, {
    capture_state: "TRANSCRIPTION_FAILED",
    dictation_error: String(reason || "Transcription failed").slice(0, 500),
  });
  await emitEvent(client, { eventTypeKey: events.DICTATION_FAILED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), actorUserId: actor.user_id || null, priority: "HIGH" });
  await audit(client, { actorUserId: actor.user_id || null, action: events.DICTATION_FAILED, moduleKey: events.MODULE, entityRef: sectionRef(meetingId, sectionKey), after: { reason: row.dictation_error } });
  return row;
}

/* ── Probing questions (per-tenant configuration) ─────────────────────────── */

async function listPrompts(client, q = {}) {
  const rows = await repo.listPrompts(client, {
    sectionKey: q.section_key || null,
    includeInactive: q.include_inactive === true || q.include_inactive === "true",
  });
  return rules.SECTIONS.map((s) => ({ ...s, prompts: rows.filter((p) => p.section_key === s.key) }));
}

async function createPrompt(client, { data, actor = {} }) {
  rules.assertSection(data.section_key);
  const row = await repo.insertPrompt(client, {
    section_key: data.section_key,
    prompt_en: data.prompt_en,
    // One question, two languages, written together. A prompt that exists in
    // only one language becomes a blank box for half the users the day the
    // language toggle lands.
    prompt_fr: data.prompt_fr,
    sort_order: data.sort_order ?? 0,
    is_active: data.is_active !== false,
    is_system: false,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.PROMPT_CHANGED, moduleKey: events.MODULE, entityRef: "meeting_discovery_prompt:" + row.meeting_discovery_prompt_id, after: row });
  return row;
}

async function updatePrompt(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getPrompt(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Prompt not found", 404);
  const fields = {};
  for (const k of ["prompt_en", "prompt_fr", "sort_order", "is_active"]) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.updatePrompt(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.PROMPT_CHANGED, moduleKey: events.MODULE, entityRef: "meeting_discovery_prompt:" + id, before, after: row });
  return row;
}

async function get(client, id) {
  const m = await repo.get(client, id);
  if (!m) return null;
  const [notes, sections, prompts] = await Promise.all([
    repo.listNotes(client, id), repo.listSections(client, id), repo.listPrompts(client, {}),
  ]);
  m.notes = notes;
  m.discovery = rules.mergeSet(sections, id).map((s) => ({
    ...s,
    ...(rules.SECTIONS.find((d) => d.key === s.section_key) || {}),
    prompts: prompts.filter((p) => p.section_key === s.section_key),
  }));
  return m;
}

const list = (client, q) => repo.list(client, q);

module.exports = {
  create, update, addNote, get, list,
  discovery, saveSection, latestDiscoveryFor,
  startDictation, applyTranscript, failDictation,
  listPrompts, createPrompt, updatePrompt,
};
