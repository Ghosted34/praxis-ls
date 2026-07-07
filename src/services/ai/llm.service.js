/**
 * LLM chat + function-calling with provider routing: DeepSeek (primary, via the
 * OpenAI-compatible SDK) → Gemini (fallback). Used by the orchestrator.
 */
"use strict";

const { groups } = require("../../config/env");
const { logger } = require("../../config/logger");

let deepseek = null;
function ds() {
  if (!deepseek) {
    const OpenAI = require("openai");
    deepseek = new OpenAI({
      apiKey: groups.ai.deepseek.key,
      baseURL: groups.ai.deepseek.baseUrl,
    });
  }
  return deepseek;
}

/**
 * One chat turn. `tools` is an OpenAI-style function-tool array (from the
 * ai_action_catalogue). Returns { text, toolCalls, usage, provider }.
 */
async function chat({ messages, tools, temperature = 0.2 }) {
  try {
    const res = await ds().chat.completions.create({
      model: groups.ai.deepseek.model,
      messages,
      tools,
      tool_choice: tools ? "auto" : undefined,
      temperature,
    });
    const m = res.choices[0].message;
    return {
      provider: "deepseek",
      text: m.content || "",
      toolCalls: m.tool_calls || [],
      usage: res.usage || {},
    };
  } catch (err) {
    logger.warn({ err: err.message }, "deepseek failed → gemini fallback");
    return geminiFallback({ messages });
  }
}

async function geminiFallback({ messages }) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(groups.ai.gemini.key);
  const model = genAI.getGenerativeModel({ model: groups.ai.gemini.model });
  const prompt = messages.map((m) => `${m.role}: ${m.content || ""}`).join("\n");
  const res = await model.generateContent(prompt);
  return { provider: "gemini", text: res.response.text(), toolCalls: [], usage: {} };
}

module.exports = { chat };
