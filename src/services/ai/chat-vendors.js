/**
 * The chat vendor chain — which providers can answer a /chat/completions call,
 * and the order they are tried in when nobody has chosen otherwise.
 *
 * WHY THIS IS ITS OWN FILE. `llm.service` (the runtime) needs the list to build
 * the chain, and `platform/ai-vendor.service` (the console's store) needs it to
 * refuse "make `groq` the primary chat provider" — Groq is voice-to-text and
 * would resolve, be tried first on every turn, 404, and fall back, forever.
 * The runtime requires the store, so the store cannot require the runtime
 * without a cycle; the list lives beneath both.
 *
 * Adding a chat vendor means adding it HERE and to `ENV_VENDORS` in
 * `llm.service` (the .env-fallback shape); the console can then offer it as
 * primary once its `ai_vendor_credential` row exists.
 */
"use strict";

/** Vendors that speak the OpenAI /chat/completions shape, i.e. can be primary. */
const CHAT_VENDORS = Object.freeze(["deepseek", "gemini", "openai"]);

/**
 * The chain used when the platform has not chosen a primary (or cannot be
 * asked — the platform DB is unreachable at boot). Order matters: the first
 * is tried first. `DEFAULT_PRIMARY` is what every deployment ran on before
 * the choice existed, so a deployment that never opens the console changes
 * nothing.
 */
const DEFAULT_CHAIN = Object.freeze(["deepseek", "gemini"]);
const DEFAULT_PRIMARY = DEFAULT_CHAIN[0];
const DEFAULT_FALLBACK = DEFAULT_CHAIN[1];

/**
 * The ordered chain for a given first choice: `first`, then the default chain
 * with `first` removed. A chosen primary therefore always keeps a DISTINCT
 * fallback behind it (audit B2: a chain whose primary equals its fallback has
 * nothing to fall back to), and choosing the default primary yields the
 * default chain exactly.
 *
 * `first` is NOT checked against `CHAT_VENDORS` here. A caller that pins a
 * vendor by name (`llm.chat({ vendorName: "anthropic" })`, configured only as
 * a platform row) is asking for exactly that vendor first, and it was honoured
 * before the platform choice existed. The check belongs where the name is
 * untrusted: `setChatPrimary` at write time and `preferredPrimary` at read
 * time, both on the platform flag.
 */
function chainFrom(first) {
  const head = first || DEFAULT_PRIMARY;
  return [head, ...DEFAULT_CHAIN.filter((v) => v !== head)];
}

module.exports = { CHAT_VENDORS, DEFAULT_CHAIN, DEFAULT_PRIMARY, DEFAULT_FALLBACK, chainFrom };
