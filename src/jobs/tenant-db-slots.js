/**
 * A per-tenant cap on the connections BACKGROUND work may hold at once, per
 * process (calls audit PR-5; found by scripts/load-calls.js).
 *
 * A tenant's pool is TENANT_POOL_MAX connections per process. Workers run
 * several jobs at once for whichever tenants are queued, so one tenant with a
 * transcription backlog could take its whole pool, and its own ring deadline,
 * ringing reads and API requests then queued behind transcription. The call
 * pipeline's jobs take a slot before each short connection; two connections
 * are always left for everything else.
 */
"use strict";

const { config } = require("../config/env");

const state = new Map(); // slug → { busy, waiters: [] }

function cap() {
  return Math.max(1, (Number(config.TENANT_POOL_MAX) || 4) - 2);
}

function entry(slug) {
  if (!state.has(slug)) state.set(slug, { busy: 0, waiters: [] });
  return state.get(slug);
}

async function withTenantSlot(slug, fn) {
  const e = entry(slug || "?");
  if (e.busy >= cap()) await new Promise((resolve) => e.waiters.push(resolve));
  else e.busy += 1;
  try {
    return await fn();
  } finally {
    const next = e.waiters.shift();
    if (next) next();
    else e.busy -= 1;
  }
}

const inUse = (slug) => (state.get(slug) || { busy: 0 }).busy;

module.exports = { withTenantSlot, inUse, cap };
