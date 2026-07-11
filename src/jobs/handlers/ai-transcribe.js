/**
 * Worker job: voice note → transcript → same assistant pipeline (AI_ARCHITECTURE
 * §3/§4). Job data: { tenantMeta, env, user, audioBase64, mimeType,
 * conversationId }. Governance-gated on the `voice` feature; usage (audio
 * seconds) is recorded against the budget period.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const transcription = require("../../services/ai/transcription.service");
const orchestrator = require("../../services/ai/orchestrator.service");
const governance = require("../../modules/ai/governance/governance.service");
const { buildExecutorMap } = require("../../services/ai/action-registrar");

const executor = buildExecutorMap();

module.exports = async function aiTranscribe(job) {
  const { tenantMeta, env = "live", user, audioBase64, mimeType, conversationId } = job.data || {};
  if (!tenantMeta || !user || !audioBase64) throw new Error("ai-transcribe needs tenantMeta + user + audioBase64");

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const gate = await governance.canUseFeature(c, { userId: user.user_id, featureKey: "voice" });
    if (!gate.allowed) return { blocked: true, reason: gate.reason };

    const vendor = await governance.getVendorConfig(c, "groq");
    const audio = Buffer.from(audioBase64, "base64");
    const { text, audio_seconds, provider } = await transcription.transcribe({ audio, mimeType, vendor });
    await governance.recordUsage(c, { userId: user.user_id, featureKey: "voice", conversationId, provider, callType: "transcribe", audioSeconds: audio_seconds });

    // Feed the transcript into the same propose→confirm turn (feature: voice).
    const turn = await orchestrator.ask({ client: c, user, conversationId, message: text, allowed: ["normal"], feature: "voice" });
    return { transcript: text, ...turn, executor_ready: Object.keys(executor).length };
  });
};
