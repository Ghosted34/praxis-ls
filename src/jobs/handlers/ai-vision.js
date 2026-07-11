/**
 * Worker job: document image (BL / invoice / receipt) → structured fields →
 * prefilled assistant turn (AI_ARCHITECTURE §3/§5). Job data: { tenantMeta, env,
 * user, imageBase64, mimeType, prompt, conversationId }. Governance-gated on the
 * `doc_vision` feature. The extracted fields are handed to the orchestrator so any
 * resulting write still goes through propose→confirm.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const vision = require("../../services/ai/vision.service");
const orchestrator = require("../../services/ai/orchestrator.service");
const governance = require("../../modules/ai/governance/governance.service");

module.exports = async function aiVision(job) {
  const { tenantMeta, env = "live", user, imageBase64, mimeType, prompt, conversationId } = job.data || {};
  if (!tenantMeta || !user || !imageBase64) throw new Error("ai-vision needs tenantMeta + user + imageBase64");

  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const gate = await governance.canUseFeature(c, { userId: user.user_id, featureKey: "doc_vision" });
    if (!gate.allowed) return { blocked: true, reason: gate.reason };

    const vendor = await governance.getVendorConfig(c, "gemini");
    const image = Buffer.from(imageBase64, "base64");
    const { fields, provider } = await vision.extract({ image, mimeType, prompt, vendor });
    await governance.recordUsage(c, { userId: user.user_id, featureKey: "doc_vision", conversationId, provider, callType: "vision" });

    const message = `A document was scanned. Extracted fields: ${JSON.stringify(fields)}. Propose the appropriate action to record it.`;
    const turn = await orchestrator.ask({ client: c, user, conversationId, message, allowed: ["normal"], feature: "doc_vision" });
    return { extracted: fields, ...turn };
  });
};
