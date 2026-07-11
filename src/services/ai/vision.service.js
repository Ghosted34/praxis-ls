/**
 * Document-vision (AI_ARCHITECTURE §3/§5). Provider: Gemini vision. Given a
 * scanned BL / invoice / receipt image + an extraction prompt, returns structured
 * fields that prefill an action (which still goes through propose→confirm).
 * Keys from governance vendor config where set, else platform env.
 */
"use strict";

const { logger } = require("../../config/logger");

/**
 * extract({ image, mimeType, prompt, vendor }) → { fields, raw, provider }.
 * `image` is a Buffer; `fields` is best-effort parsed JSON of the model's answer.
 */
async function extract({ image, mimeType = "image/jpeg", prompt, vendor = null }) {
  const apiKey = vendor && vendor.api_key;
  if (!apiKey) throw new Error("document-vision provider not configured (Gemini key missing)");
  if (!Buffer.isBuffer(image) || image.length === 0) throw new Error("extract needs a non-empty image Buffer");

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: (vendor && vendor.model) || "gemini-1.5-pro" });
  const instruction =
    (prompt || "Extract the key fields from this logistics document") +
    ". Respond ONLY with a compact JSON object of field:value pairs.";
  try {
    const res = await model.generateContent([
      instruction,
      { inlineData: { data: image.toString("base64"), mimeType } },
    ]);
    const raw = res.response.text();
    let fields = {};
    try { fields = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim()); } catch { fields = {}; }
    return { fields, raw, provider: "gemini" };
  } catch (err) {
    logger.warn({ err: err.message }, "vision extract failed");
    throw err;
  }
}

module.exports = { extract };
