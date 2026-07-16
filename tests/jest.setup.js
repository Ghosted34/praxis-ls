"use strict";

// Deterministic env for unit tests: development mode with dev-safe secrets so
// modules that read config at require-time don't trip the production guard.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

// Isolate unit tests from the developer's local .env. env.js runs
// dotenv.config() at require-time, which would otherwise pull real/placeholder
// provider keys (GROQ_API_KEY=__rotate*me__, SMTP_HOST=__host__, etc.) into the
// test process and defeat the "not configured / no sender" guards. dotenv does
// not override an already-set var, so pinning these to "" here (before any
// service requires env.js) keeps the "no provider configured" paths testable.
for (const k of [
  "GROQ_API_KEY", "WHISPER_BASE_URL",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
]) {
  process.env[k] = "";
}
