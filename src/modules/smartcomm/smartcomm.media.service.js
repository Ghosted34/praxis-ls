/**
 * Smart Comms media (MOD-64) — what happens to the bytes somebody drops into a
 * chat.
 *
 * ── THE SPLIT THIS FILE EXISTS TO MAKE ─────────────────────────────────────
 *
 * Two destinations, chosen by what the file IS, not by who uploaded it:
 *
 *   a real document  (pdf, xlsx, docx, csv, …)  → document_vault
 *   a chat medium    (image, audio, video)      → comms_media
 *
 * The vault is the register of things the company must be able to produce on
 * demand: retention, audit, QES signature, certified verification. A customs
 * declaration pasted into an ops channel belongs there. A photo of a whiteboard
 * does not, and sending it there anyway is how the answer to "what documents do
 * we hold about this client" becomes unusable within a month. See the header of
 * migration 13794.
 *
 * The split is reversible in the direction that matters: `promote()` moves a
 * chat image into the vault the moment somebody decides it was a record after
 * all, and does it through `document_vault.createDocument` so the vault row is
 * hashed from the master the image pipeline returns — never from the bytes this
 * module happened to store. `document_signature` records `artifact_hash` from
 * that `content_hash` and `document_verification` compares the two, so a
 * shortcut here would fail verification on a document nobody had touched.
 *
 * ── WHY THE BYTES DO NOT GO THROUGH /media ─────────────────────────────────
 *
 * `/media/<key>` is an UNAUTHENTICATED static mount with an allow-list of
 * public prefixes (server.js) — the logo, the login background, things that
 * must render before there is a token. A private conversation's attachments are
 * the opposite of that. They are served by `bytes()` below, behind
 * authMiddleware and the same `assertMember` that guards every other read in
 * this module: a key that leaks tells you nothing, because knowing the key is
 * not what grants access.
 *
 * ── COMPRESSION IS NOT OPTIONAL AND THE PROFILE IS NOT COSMETIC ────────────
 *
 * Every image goes through `image-pipeline.service.js`. Chat photos take the
 * `photo` profile (tonally corrected — it is a photo, and it should look like
 * one on a 96px bubble); anything routed to the vault takes `document`, which
 * downscales and re-encodes but applies NO tonal correction, because a levelled
 * customs scan stops matching the paper it came from.
 */
"use strict";

const crypto = require("crypto");
const storage = require("../../services/storage.service");
const imagePipeline = require("../../services/image-pipeline.service");
const transcription = require("../../services/ai/transcription.service");
const vault = require("../vault/document_vault/document_vault.service");
const repo = require("./smartcomm.repo");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const { resolveActorId } = require("../../shared/events/emit");

/** A chat attachment ceiling, below the 25 MB multipart cap. WhatsApp's own
 *  limit for a document is 100 MB and for media 16 MB; this sits with media,
 *  because the thing being protected is the phone on the other end opening it
 *  over a corridor connection. */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** A voice note is a message, not a podcast. Two minutes is the same ceiling
 *  the recorder enforces client-side; this is the one that counts. */
const MAX_VOICE_MS = 120_000;

const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/gif"]);
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/m4a", "audio/x-m4a", "audio/wav", "audio/x-wav"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/ogg"]);

const EXT = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif",
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
  "audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
};

/** The bare media type, without the parameters a browser attaches. MediaRecorder
 *  always produces one — `audio/webm;codecs=opus` — and a Set lookup that keeps
 *  the parameter matches nothing. */
const bare = (t) => String(t || "").split(";")[0].trim().toLowerCase();

/**
 * Which store this file belongs in.
 *
 * Returns "MEDIA" for the three chat media, "VAULT" for everything else. There
 * is deliberately no third answer: a type nobody recognises is a document, and
 * a document is the destination with the audit trail. Refusing it instead would
 * mean an operator who receives a .p7s or a .dwg cannot put it in front of a
 * colleague without leaving the product.
 */
function routeFor(contentType) {
  const t = bare(contentType);
  if (IMAGE_TYPES.has(t)) return { store: "MEDIA", kind: "IMAGE" };
  if (AUDIO_TYPES.has(t)) return { store: "MEDIA", kind: "AUDIO" };
  if (VIDEO_TYPES.has(t)) return { store: "MEDIA", kind: "VIDEO" };
  return { store: "VAULT", kind: null };
}

/**
 * Peaks, sanitised.
 *
 * These arrive from the recorder in the browser, which means they arrive from
 * anyone who can POST. They are drawn as bar heights and nothing else, so the
 * only thing that must hold is that they are a bounded array of small integers
 * — an unbounded one is a row that makes every later thread read slower, and
 * the client renders a fixed number of bars regardless.
 */
function cleanWaveform(input) {
  if (!Array.isArray(input) || !input.length) return null;
  const peaks = input
    .slice(0, 64)
    .map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
  return peaks.length ? peaks : null;
}

/**
 * Store one uploaded file against a channel.
 *
 * `file` is multer-shaped ({ buffer, mimetype, originalname }) — the same shape
 * `readUpload` returns for either transport, so this does not care whether the
 * bytes arrived as multipart or as a base64 data URL.
 *
 * Returns an ATTACHMENT DESCRIPTOR, not a message: the composer uploads while
 * the user is still typing, then posts one message carrying the descriptors it
 * collected. That ordering is what lets a picture appear in the bubble the
 * instant the message is sent rather than a second later.
 */
async function store(client, { groupId, file, isVoiceNote = false, durationMs = null, waveform = null, width = null, height = null, slug, actor = {} }) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new AppError("EMPTY_FILE", "That file is empty", 422);
  }
  const contentType = bare(file.mimetype);
  const route = routeFor(contentType);

  // A document keeps the vault's own 25 MB ceiling and the vault's own
  // handling; only chat media is held to the tighter media limit.
  if (route.store === "VAULT") {
    const doc = await vault.createDocument(client, {
      entityRef: "comms_group:" + groupId,
      docType: "COMMS_ATTACHMENT",
      file,
      originalName: file.originalname || null,
      slug,
      actor,
    });
    return {
      attachment_kind: "VAULT",
      vault_id: doc.doc_id,
      filename: file.originalname || null,
      content_type: contentType,
      size_bytes: file.buffer.length,
    };
  }

  if (file.buffer.length > MAX_MEDIA_BYTES) {
    throw new AppError("FILE_TOO_LARGE", `Media exceeds ${MAX_MEDIA_BYTES / (1024 * 1024)} MB`, 413, {
      user_message: `That file is larger than ${MAX_MEDIA_BYTES / (1024 * 1024)} MB. Send it as a document, or export it smaller.`,
    });
  }
  if (isVoiceNote && Number(durationMs) > MAX_VOICE_MS) {
    throw new AppError("VOICE_TOO_LONG", "A voice note is capped at two minutes", 422, {
      user_message: "That recording is longer than two minutes. Send it in parts, or attach it as a file.",
    });
  }

  // `photo`, not `document`: a chat image should look like a photograph on a
  // small bubble. Audio and video are not processable and pass straight
  // through — `processImage` returns them unchanged.
  const processed = imagePipeline.isProcessable(contentType)
    ? await imagePipeline.processImage(
      { buffer: file.buffer, mimetype: contentType, originalname: file.originalname || `upload.${EXT[contentType] || "bin"}` },
      { profile: "photo" },
    )
    : null;

  const storedBuffer = processed ? processed.master.buffer : file.buffer;
  const storedType = processed ? (processed.master.mime_type || contentType) : contentType;
  const ext = EXT[storedType] || EXT[contentType] || "bin";
  // `chat/`, not `vault/`: the /media allow-list in server.js serves neither,
  // but keeping them apart means a future allow-list change cannot widen into
  // conversation attachments by accident.
  const key = `tenant_${slug}/chat/media_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await storage.put(storedBuffer, { key, contentType: storedType });
  if (processed) await imagePipeline.putDerivatives(key, processed.derivatives);

  const row = await repo.insertMedia(client, {
    group_id: groupId,
    // Through resolveActorId, not actor.user_id (DATA 2.4): identity lives in
    // the LIVE schema while this write can land in SANDBOX, where that user
    // does not exist and Postgres answers 23503. Losing an attribution is a
    // smaller harm than losing the upload.
    uploaded_by: await resolveActorId(client, actor.user_id),
    kind: route.kind,
    storage_path: key,
    content_type: storedType,
    size_bytes: storedBuffer.length,
    original_name: file.originalname || null,
    width: processed ? (processed.master.width ?? width) : width,
    height: processed ? (processed.master.height ?? height) : height,
    duration_ms: Number.isFinite(Number(durationMs)) ? Math.round(Number(durationMs)) : null,
    waveform: cleanWaveform(waveform),
    is_voice_note: isVoiceNote === true,
    // NOTHING is queued. A voice note lands with no transcript and says so,
    // because transcription is now something a READER asks for — see
    // `transcribeVoiceNote`. "PENDING" here used to mean "a provider call is
    // already in flight for this clip", and a row that says that when no call
    // was ever made is a spinner nobody will ever come back to clear.
    transcript_status: "NONE",
  });

  return {
    attachment_kind: "MEDIA",
    media_id: row.media_id,
    kind: row.kind,
    filename: row.original_name,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes) || 0,
    width: row.width,
    height: row.height,
    duration_ms: row.duration_ms,
    waveform: row.waveform,
    is_voice_note: row.is_voice_note,
    transcript_status: row.transcript_status,
  };
}

/**
 * Transcribe a voice note, WHEN SOMEBODY ASKS FOR IT.
 *
 * ── WHY IT IS NOT DONE ON UPLOAD ANY MORE ─────────────────────────────────
 *
 * It used to fire, unawaited, the moment a clip landed: every voice note in
 * every channel went to the provider whether anyone ever wanted the words or
 * not. That is a per-clip bill and a per-clip copy of a private conversation
 * leaving the tenant, paid on the guess that someone will read it. Most voice
 * notes are listened to, once, by the two people in the thread.
 *
 * So the READER asks. `transcript_status` on a fresh clip is NONE, the bubble
 * offers a Transcribe button, and this runs for the one clip that was pressed.
 *
 * The result IS stored, and that is deliberate rather than an oversight about
 * caching: the second person to press the button in the same channel must get
 * the same words as the first, and `certifiedExport` folds transcripts into the
 * SHA-256'd record of the channel — a transcript that lived only in one
 * reader's tab would be absent from the legal record of exactly the message
 * format that has no text of its own.
 *
 * The three failure shapes stay distinguishable, because they need three
 * different sentences on screen:
 *   UNAVAILABLE — nobody has configured a provider. The operator's problem,
 *                 and the client's cue to offer the browser's own recogniser.
 *   FAILED      — a provider answered badly, or the clip had no speech in it.
 *   DONE + ""   — it transcribed, and there were no words. Also DONE.
 */
async function transcribeVoiceNote(client, { mediaId, language = null, assertMember, actor = {} }) {
  const media = await repo.getMedia(client, mediaId);
  if (!media) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  // Membership, re-checked here for the same reason `bytes` re-checks it: an id
  // that reaches a non-member must answer the same way as an id that does not
  // exist. This one also SPENDS MONEY on the tenant's provider account, so a
  // stranger being able to drive it is a bill as well as a disclosure.
  if (assertMember) await assertMember(client, media.group_id, actor.user_id);
  if (!media.is_voice_note) {
    throw new AppError("NOT_A_VOICE_NOTE", "That attachment is not a voice note", 422);
  }
  // Already transcribed: hand back what the first reader's press produced
  // rather than paying for the same clip again.
  if (media.transcript_status === "DONE") return media;

  let audio;
  try {
    audio = await storage.get(media.storage_path);
  } catch (err) {
    logger.warn({ err, media_id: mediaId }, "voice note bytes unreadable for transcription");
    return repo.setMediaTranscript(client, mediaId, { transcript: null, status: "FAILED" });
  }
  try {
    const { text } = await transcription.transcribe({
      audio,
      mimeType: media.content_type,
      language,
    });
    return await repo.setMediaTranscript(client, mediaId, {
      transcript: String(text || "").trim() || null,
      status: "DONE",
    });
  } catch (err) {
    const unconfigured = /not configured/i.test(err && err.message ? err.message : "");
    logger.warn({ err, media_id: mediaId }, "voice note transcription failed");
    return repo.setMediaTranscript(client, mediaId, {
      transcript: null,
      status: unconfigured ? "UNAVAILABLE" : "FAILED",
    });
  }
}

/**
 * The bytes, for a member of the channel the media was posted in.
 *
 * Membership is re-checked here and not inferred from the media id, for the
 * same reason `react` and `star` grew a check (API F-22): an id that reaches a
 * non-member must answer the same way as an id that does not exist.
 */
async function bytes(client, { mediaId, assertMember, actor }) {
  const media = await repo.getMedia(client, mediaId);
  if (!media) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  await assertMember(client, media.group_id, actor.user_id);
  const buffer = await storage.get(media.storage_path);
  return { media, buffer };
}

/**
 * "Save to vault" — this chat image WAS a record after all.
 *
 * Idempotent: a second promotion returns the first vault row rather than
 * filing the same photo twice, because the button is on a bubble that several
 * people are looking at.
 */
async function promote(client, { mediaId, assertMember, actor, slug, docType = "COMMS_ATTACHMENT", entityRef = null }) {
  const media = await repo.getMedia(client, mediaId);
  if (!media) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  await assertMember(client, media.group_id, actor.user_id);
  if (media.promoted_vault_id) return { media_id: mediaId, vault_id: media.promoted_vault_id, already: true };

  const buffer = await storage.get(media.storage_path);
  const doc = await vault.createDocument(client, {
    entityRef: entityRef || "comms_group:" + media.group_id,
    docType,
    // Through createDocument rather than a direct repo insert, so the vault
    // row's content_hash is taken over the master the image pipeline returns.
    // See the header.
    file: {
      buffer,
      mimetype: media.content_type,
      originalname: media.original_name || `chat-media.${EXT[media.content_type] || "bin"}`,
    },
    originalName: media.original_name || null,
    slug,
    actor,
  });
  await repo.setMediaPromoted(client, mediaId, doc.doc_id);
  return { media_id: mediaId, vault_id: doc.doc_id, already: false };
}

module.exports = {
  store, bytes, promote, transcribeVoiceNote,
  routeFor, cleanWaveform,
  MAX_MEDIA_BYTES, MAX_VOICE_MS,
};
