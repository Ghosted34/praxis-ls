/**
 * The transcription gate (calls audit D2, §4; PR-5 step 2).
 *
 * Two controls in front of every call part's provider call:
 *
 *   Provider limiters. One per provider key, shared by every worker through
 *   Redis: Groq by requests a minute and audio-seconds an hour, Gemini by
 *   requests a minute (sized from configuration, to the plan on the key).
 *   `route()` picks Groq while it has room and Gemini when Groq is full,
 *   which is owner decision O1: a full Groq limiter goes straight to Gemini.
 *   When both are full no provider is called and the part waits.
 *
 *   A fair share per tenant. A GCRA bucket per tenant (`perMin`, `burst`)
 *   that RESERVES a slot for each part: a tenant with 2,000 parts queued
 *   gets 2,000 distinct start times spread at its own rate, each job waits
 *   once until its slot, and every other tenant's parts go straight through.
 *
 * WHEN REDIS FAILS both fall back to in-process state with the same limits
 * (logged at WARN): per process, so looser across replicas, never unlimited.
 */
"use strict";

const { logger } = require("../../config/logger");

const TENANT_KEY = (slug) => `praxis:calltx:tat:${slug}`;
const RPM_KEY = (provider, minute) => `praxis:calltx:rpm:${provider}:${minute}`;
const AUDIO_KEY = (provider, hour) => `praxis:calltx:aud:${provider}:${hour}`;

function limits(overrides = {}) {
  const { config } = require("../../config/env");
  return {
    groqRpm: config.GROQ_TRANSCRIBE_RPM,
    groqAudioPerHour: config.GROQ_TRANSCRIBE_AUDIO_SECONDS_PER_HOUR,
    geminiRpm: config.GEMINI_TRANSCRIBE_RPM,
    tenantPerMin: config.CALL_TRANSCRIBE_TENANT_PER_MIN,
    tenantBurst: config.CALL_TRANSCRIBE_TENANT_BURST,
    ...overrides,
  };
}

/* ── In-process fallback state ─────────────────────────────────────────── */
const local = { tat: new Map(), windows: new Map() };
let lastWarn = 0;
function warnFallback(err, what) {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  logger.warn({ err }, `call transcription ${what}: Redis unavailable — using per-process limits`);
}

/* ── Per-tenant fair share (GCRA with reservation) ─────────────────────── */

function gcra(tat, now, { perMin, burst }) {
  const interval = 60_000 / Math.max(1, perMin);
  const tau = interval * Math.max(1, burst);
  const base = Math.max(tat || 0, now);
  const startAt = Math.max(now, base + interval - tau);
  return { next: base + interval, waitMs: Math.max(0, Math.ceil(startAt - now)) };
}

/**
 * Reserve this tenant's next slot. Returns how long the part must wait (0 =
 * now). Every call consumes a slot, so call it once per part: a job that has
 * waited for its reservation runs without asking again.
 */
async function reserveTenantSlot(redis, { slug, now = Date.now(), ...opts }) {
  const { tenantPerMin: perMin, tenantBurst: burst } = limits(opts);
  const key = TENANT_KEY(slug);
  try {
    for (let i = 0; i < 8; i += 1) {
      await redis.watch(key);
      const tat = Number(await redis.get(key)) || 0;
      const { next, waitMs } = gcra(tat, now, { perMin, burst });
      const ttl = Math.ceil(next - now) + 60_000;
      const res = await redis.multi().set(key, String(next), "PX", ttl).exec();
      if (res) return waitMs;
    }
    throw new Error("tenant slot contended");
  } catch (err) {
    warnFallback(err, "fair share");
    const { next, waitMs } = gcra(local.tat.get(slug), now, { perMin, burst });
    local.tat.set(slug, next);
    return waitMs;
  }
}

/* ── Provider limiters (fixed windows, shared) ─────────────────────────── */

async function takeWindow(redis, key, amount, max, ttlMs) {
  const res = await redis.multi().incrby(key, amount).pexpire(key, ttlMs).exec();
  const total = Number(res[0][1]);
  if (total <= max) return true;
  await redis.incrby(key, -amount);
  return false;
}

function takeLocal(key, amount, max, ttlMs, now) {
  const w = local.windows.get(key);
  const cur = w && w.until > now ? w.n : 0;
  if (cur + amount > max) return false;
  local.windows.set(key, { n: cur + amount, until: now + ttlMs });
  return true;
}

/** One request (and, for Groq, `seconds` of audio) against a provider's key.
 *  True if taken; false if that provider's limiter is full. */
async function takeProvider(redis, provider, { seconds = 0, now = Date.now(), ...opts } = {}) {
  const l = limits(opts);
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);
  const rpm = provider === "groq" ? l.groqRpm : l.geminiRpm;
  const audioCap = provider === "groq" ? l.groqAudioPerHour : 0;
  const secs = Math.max(0, Math.round(seconds));
  try {
    if (!(await takeWindow(redis, RPM_KEY(provider, minute), 1, rpm, 120_000))) return false;
    if (audioCap > 0 && !(await takeWindow(redis, AUDIO_KEY(provider, hour), secs, audioCap, 7_200_000))) {
      await redis.incrby(RPM_KEY(provider, minute), -1);
      return false;
    }
    return true;
  } catch (err) {
    warnFallback(err, "provider limiter");
    const rk = `${provider}:m:${minute}`;
    if (!takeLocal(rk, 1, rpm, 120_000, now)) return false;
    if (audioCap > 0 && !takeLocal(`${provider}:h:${hour}`, secs, audioCap, 7_200_000, now)) {
      local.windows.get(rk).n -= 1;
      return false;
    }
    return true;
  }
}

/**
 * Which provider this part goes to first: "groq" while Groq has room,
 * "gemini" when Groq is full and Gemini has room, null when both are full
 * (retry after `retryInMs`, calling nobody).
 */
async function route(redis, { seconds = 120, now = Date.now(), ...opts } = {}) {
  if (await takeProvider(redis, "groq", { seconds, now, ...opts })) return { provider: "groq" };
  if (await takeProvider(redis, "gemini", { now, ...opts })) return { provider: "gemini", groqFull: true };
  return { provider: null, retryInMs: 60_000 - (now % 60_000) + 250 };
}

/** Gemini's turn after a Groq error (O1): only if its limiter has room. */
function takeGemini(redis, { now = Date.now(), ...opts } = {}) {
  return takeProvider(redis, "gemini", { now, ...opts });
}

function resetLocalForTests() {
  local.tat.clear();
  local.windows.clear();
  lastWarn = 0;
}

module.exports = {
  reserveTenantSlot,
  takeProvider,
  takeGemini,
  route,
  gcra,
  resetLocalForTests,
  keys: { TENANT_KEY, RPM_KEY, AUDIO_KEY },
};
