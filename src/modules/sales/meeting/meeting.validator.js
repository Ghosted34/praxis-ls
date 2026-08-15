"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const { SECTION_KEYS, MAX_AUDIO_BYTES } = require("./meeting.rules");

const sectionKey = z.enum(SECTION_KEYS);

/**
 * The base64 payload is bounded HERE as well as in the service, because this is
 * the bound that stops a 200 MB body being buffered and decoded at all. The
 * service's check is on decoded bytes and is the one a user sees; this one is
 * the one that protects the process. 4/3 plus padding is the base64 expansion.
 */
const audioDataUrl = z.string().min(32).max(Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 128);

const schemas = {
  // `transcript_vault_id` is NOT here, and its absence is the fix: it used to be
  // accepted from the body, which made the flag "this meeting has a transcript"
  // an assertion the caller made about itself. Only the ai-transcribe worker
  // writes it now.
  create: z.object({
    subject: z.string().min(1).max(300),
    lead_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    scheduled_at: z.string().optional().nullable(),
    location: z.string().max(300).optional().nullable(),
    organiser_id: z.string().uuid().optional().nullable(),
  }),
  update: z.object({
    subject: z.string().min(1).max(300).optional(),
    lead_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
    scheduled_at: z.string().optional().nullable(),
    location: z.string().max(300).optional().nullable(),
    organiser_id: z.string().uuid().optional().nullable(),
  }),
  note: z.object({ body: z.string().min(1), is_minutes: z.boolean().optional() }),
  // A section may be emptied — clearing an answer is an answer — so min(0).
  section: z.object({ body: z.string().max(20000).nullable().optional() }),
  dictate: z.object({ audio: audioDataUrl }),
  prompt: z.object({
    section_key: sectionKey,
    prompt_en: z.string().min(1).max(500),
    prompt_fr: z.string().min(1).max(500),
    sort_order: z.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  }),
  promptPatch: z.object({
    prompt_en: z.string().min(1).max(500).optional(),
    prompt_fr: z.string().min(1).max(500).optional(),
    sort_order: z.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  }),
  // AI-facing: meeting_id in the payload → list_meetings picker.
  aiNote: z.object({ meeting_id: z.string().uuid(), body: z.string().min(1), is_minutes: z.boolean().optional() }),
  aiSection: z.object({ meeting_id: z.string().uuid(), section_key: sectionKey, body: z.string().max(20000) }),
  aiDiscovery: z.object({ lead_id: z.string().uuid() }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

/** The section key travels in the URL, so it is checked there — before the
 *  route picks a handler, and with the same vocabulary as the body schemas. */
const sectionParam = (req, _res, next) => {
  const p = sectionKey.safeParse(req.params.sectionKey);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", `Unknown discovery section — expected one of ${SECTION_KEYS.join(", ")}`, 422));
  return next();
};

module.exports = {
  create: mw("create"), update: mw("update"), note: mw("note"),
  section: mw("section"), dictate: mw("dictate"),
  prompt: mw("prompt"), promptPatch: mw("promptPatch"),
  sectionParam, schemas,
};
