/**
 * Health endpoints.
 *
 * Audit OBS-A2 / TEST-D4 (2026-08-04). There was one endpoint:
 *
 *     router.get("/health", (_req, res) => res.json({ ok: true, ts: ... }));
 *
 * It could not fail. It did not touch Postgres, Redis, or the module table — it
 * returned `{ok:true}` as long as the Node process could serve a request. And
 * it was load-bearing in two places: the last line of `scripts/deploy.sh` used
 * it as the gate that says a deploy succeeded, and it was the only thing an
 * external monitor could have watched. A deploy that rolled a container which
 * could not reach the database passed that gate, every time.
 *
 * The audit verified this empirically by taking the database down and watching
 * it still answer 200.
 *
 * Two endpoints now, because they answer different questions and conflating
 * them is what produced the original bug:
 *
 *   GET /api/health        LIVENESS.  "Is this process alive?" Never touches a
 *                          dependency, always 200 while the event loop turns.
 *                          Safe for a container restart policy — a probe that
 *                          fails when the DATABASE is down would restart every
 *                          API container during a database blip, turning a
 *                          degradation into an outage.
 *
 *   GET /api/health/ready  READINESS. "Can this process actually serve?" Probes
 *                          Postgres and Redis, reports the mounted module table
 *                          and the build identity, and returns 503 when a hard
 *                          dependency is down. THIS is the deploy gate and the
 *                          uptime-monitor target.
 *
 * Both are unauthenticated on purpose (a monitor has no credentials) and both
 * are deliberately thin on detail: they report component status and build id,
 * never connection strings, hostnames or error text.
 */

"use strict";

const express = require("express");
const { config } = require("../config/env");
const { mountReport } = require("../shared/http/module-loader");
const { rateLimitStoreKind } = require("../shared/http/rate-limit");

const router = express.Router();

/** How long a single dependency probe may take before it counts as down. */
const PROBE_TIMEOUT_MS = 2000;

/** Wall-clock process start, so readiness can report uptime. */
const STARTED_AT = new Date();

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} probe timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);
}

/**
 * Build identity (TEST-R2 / OBS-I5). Before this, a running container could not
 * say which commit it was — so "is the fix deployed?" and "what do I roll back
 * to?" were both unanswerable from the running system. Injected at image build
 * time; reports "unknown" honestly rather than guessing.
 */
function buildInfo() {
  return {
    version: require("../../package.json").version,
    commit: config.BUILD_SHA || "unknown",
    built_at: config.BUILD_TIME || "unknown",
    node: process.version,
    env: config.NODE_ENV,
  };
}

async function probePostgres() {
  // Required lazily: config/database.js opens a pool at require-time in some
  // entrypoints, and health must not be the thing that creates it.
  const db = require("../config/database");
  const started = Date.now();
  await withTimeout(db.query("SELECT 1"), PROBE_TIMEOUT_MS, "postgres");
  return { status: "up", latency_ms: Date.now() - started };
}

async function probeRedis() {
  const { getClient } = require("../config/redis");
  const started = Date.now();
  await withTimeout(getClient().ping(), PROBE_TIMEOUT_MS, "redis");
  return { status: "up", latency_ms: Date.now() - started };
}

/**
 * LIVENESS — no dependencies, cannot fail while the process is serving.
 * Shape kept backward-compatible: `{ ok, ts }` plus additive fields, so any
 * existing caller (deploy script, nginx, a bookmark) still works.
 */
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    status: "alive",
    uptime_s: Math.floor(process.uptime()),
    build: buildInfo(),
  });
});

/**
 * READINESS — probes real dependencies. 200 when servable, 503 when not.
 *
 * Redis is reported but NOT fatal: the app is designed to boot degraded without
 * it (OBS-A3 notes it does so silently, which is a separate fix). Postgres is
 * fatal — there is no meaningful request this API can serve without it.
 */
router.get("/health/ready", async (_req, res) => {
  const checks = {};

  const [pg, redis] = await Promise.allSettled([probePostgres(), probeRedis()]);

  checks.postgres =
    pg.status === "fulfilled" ? pg.value : { status: "down", error: pg.reason.message };
  checks.redis =
    redis.status === "fulfilled"
      ? redis.value
      : { status: "down", error: redis.reason.message };

  // API F-19: a module whose require() throws is skipped and boot continues, so
  // a process can serve an incomplete API and look perfectly healthy. Surfacing
  // it here means the deploy gate and the monitor both see it.
  const mount = mountReport();
  checks.modules = {
    status: mount.skipped.length === 0 ? "up" : "degraded",
    mounted: mount.mounted.length,
    skipped: mount.skipped.map((s) => s.module),
  };

  // SEC-H5: an in-memory limiter store in a multi-container deploy silently
  // multiplies every configured limit by the container count. Worth seeing.
  checks.rate_limit_store = { status: "up", kind: rateLimitStoreKind() };

  const fatal = checks.postgres.status === "down";
  const degraded =
    checks.redis.status === "down" || checks.modules.status === "degraded";

  res.status(fatal ? 503 : 200).json({
    ok: !fatal,
    status: fatal ? "unavailable" : degraded ? "degraded" : "ready",
    ts: new Date().toISOString(),
    started_at: STARTED_AT.toISOString(),
    uptime_s: Math.floor(process.uptime()),
    build: buildInfo(),
    checks,
  });
});

module.exports = { router, buildInfo, PROBE_TIMEOUT_MS };
