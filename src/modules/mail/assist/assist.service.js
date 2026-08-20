"use strict";

const { AppError } = require("../../../utils/errors");
const fence = require("./assist.factfence");
const glossary = require("./assist.glossary");
const grounding = require("./assist.grounding");
const guardrails = require("./assist.guardrails");
const prompts = require("./assist.prompts");
const { resolveLanguage } = require("../signature/language");

async function assertAiOn(client) {
  const mail = await client.query(`SELECT state FROM feature_state WHERE feature_key='mail.ai'`);
  const ceil = await client.query(`SELECT state FROM feature_state WHERE feature_key='ai.assistant.backend'`);
  if (!mail.rows[0] || mail.rows[0].state !== "on" || !ceil.rows[0] || ceil.rows[0].state !== "on") {
    throw new AppError("FEATURE_DISABLED", "Mail AI is off. It also requires ai.assistant.backend.", 403);
  }
}

async function compose(client, input = {}) {
  await assertAiOn(client);
  const lang = resolveLanguage({ explicit: input.language });
  const prompt = input.action
    ? prompts.resolveAction(input.action, lang)
    : prompts.resolvePrompt(input.tone || "formal", lang);
  return { prompt, language: lang, mode: input.mode || "compose", facts: [] };
}

async function draft(client, { threadId, facts = [], tone, language }) {
  await assertAiOn(client);
  if (grounding.isDenied("costing") !== true) {
    /* the deny list is the point */
  }
  const lang = resolveLanguage({ explicit: language });
  if (!facts.length) {
    return {
      draft_text: "", draft_html: "", facts: [], confidence: 0, language: lang,
      note: "This thread is not bound to a record, so no ERP facts were used.",
    };
  }
  return { facts, language: lang, tone: tone || "formal", fence: fence.fence("", facts) };
}

function runFence(draftText, facts) {
  return fence.fence(draftText, facts);
}

function runGlossary(original, rewritten) {
  return glossary.restore(original, rewritten);
}

function runGuardrails(message, ctx) {
  return guardrails.check(message, ctx);
}

module.exports = { compose, draft, runFence, runGlossary, runGuardrails, assertAiOn };
