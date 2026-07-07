/**
 * AI EMV gate — thin alias over the generic feature gate (kept for clarity at
 * AI call sites). requireAiFeature('ai.assistant.backend') etc.
 */
"use strict";

const { requireFeature } = require("./feature-gate");
const requireAiFeature = (key) => requireFeature(key);

module.exports = { requireAiFeature };
