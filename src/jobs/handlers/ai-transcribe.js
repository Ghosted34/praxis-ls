/**
 * Worker job: voice note → transcript (AI_ARCHITECTURE §3/§4). Governance-gated
 * on the `voice` feature; usage (audio seconds) is recorded against the budget
 * period.
 *
 * TWO DESTINATIONS, ONE PIPELINE.
 *
 * Without `target`, the transcript is a message to the copilot and goes into the
 * same propose→confirm turn a typed message would (the original behaviour).
 *
 * With `target`, the transcript belongs to a RECORD — today, one section of a
 * meeting's client-discovery capture. It is vaulted and written to that section
 * by the owning module's service. This is the half that was missing: the
 * transcription machinery worked, and nothing in the product could ask it to put
 * text anywhere. `meeting.transcript_vault_id` was read off the request body.
 *
 * WHY THE FAILURE PATH IS AS LONG AS THE SUCCESS PATH.
 *
 * A dictation that fails must be visible on the record, because the person who
 * spoke into the microphone believes their words were captured. The legacy shows
 * a toast and drops the audio (smart-quote-leads.php processAudio ~1805), so a
 * failed dictation and a section nobody filled in are indistinguishable the next
 * morning. Every exit here that is not "text landed" marks the section
 * TRANSCRIPTION_FAILED with the reason first.
 *
 * Job data: { tenantMeta, env, user, audioBase64, mimeType, conversationId,
 *             target?: { kind, meeting_id, section_key } }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const transcription = require("../../services/ai/transcription.service");
const orchestrator = require("../../services/ai/orchestrator.service");
const governance = require("../../modules/ai/governance/governance.service");
const platformVendors = require("../../services/platform/ai-vendor.service");
const meetingService = require("../../modules/sales/meeting/meeting.service");
const { buildExecutorMap } = require("../../services/ai/action-registrar");

const executor = buildExecutorMap();

/** Route a targeted transcript to the module that owns the record. */
async function deliver(client, { target, text, audioSeconds, slug, user }) {
  if (target.kind === "meeting_discovery_section") {
    return meetingService.applyTranscript(client, {
      meetingId: target.meeting_id, sectionKey: target.section_key,
      text, audioSeconds, slug, actor: user || {},
    });
  }
  throw new Error(`ai-transcribe: unknown target kind "${target.kind}"`);
}

/** Mark the record's dictation as failed. Never throws — a failure to record a
 *  failure must not replace the original error in the logs. */
async function markFailed(client, target, reason, user) {
  try {
    if (target && target.kind === "meeting_discovery_section") {
      await meetingService.failDictation(client, {
        meetingId: target.meeting_id, sectionKey: target.section_key, reason, actor: user || {},
      });
    }
  } catch {
    // Swallowed on purpose, and this is the one place it is right to: the
    // caller is already reporting the real error, and throwing from the
    // error handler would hide it.
  }
}

module.exports = async function aiTranscribe(job) {
  const { tenantMeta, env = "live", user, audioBase64, mimeType, conversationId, target = null } = job.data || {};
  if (!tenantMeta || !user || !audioBase64) throw new Error("ai-transcribe needs tenantMeta + user + audioBase64");

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const gate = await governance.canUseFeature(c, { userId: user.user_id, featureKey: "voice" });
    if (!gate.allowed) {
      // A governance refusal is not an error — it is an answer, and on a record
      // it is the answer the user needs to see next to the section they dictated.
      await markFailed(c, target, gate.reason || "Voice transcription is not available on this plan right now", user);
      return { blocked: true, reason: gate.reason };
    }

    const vendor = await platformVendors.getConfig("groq");
    const audio = Buffer.from(audioBase64, "base64");

    let result;
    try {
      result = await transcription.transcribe({ audio, mimeType, vendor });
    } catch (err) {
      // Marked BEFORE the rethrow, so the record is honest during the retry
      // window as well as after it. A later attempt that succeeds overwrites the
      // state; one that never succeeds leaves it saying so.
      await markFailed(c, target, err && err.message ? err.message : "Transcription failed", user);
      throw err;
    }
    const { text, audio_seconds, provider } = result;
    await governance.recordUsage(c, { userId: user.user_id, featureKey: "voice", conversationId, provider, callType: "transcribe", audioSeconds: audio_seconds });

    if (target) {
      const section = await deliver(c, { target, text, audioSeconds: audio_seconds, slug: tenantMeta.slug, user });
      return { transcript: text, target: target.kind, section };
    }

    // Feed the transcript into the same propose→confirm turn (feature: voice).
    const turn = await orchestrator.ask({ client: c, user, conversationId, message: text, allowed: ["normal"], feature: "voice" });
    return { transcript: text, ...turn, executor_ready: Object.keys(executor).length };
  });
};
