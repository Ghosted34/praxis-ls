/**
 * `GET /api/metrics` — Prometheus scrape target.
 *
 * Audit OBS-M1 (Critical): "No metrics of any kind, no dashboard, no baseline."
 * Without a baseline you cannot tell a bad day from a normal one, and every
 * capacity question ("can we take another tenant?") is a guess.
 *
 * WHAT IS EXPOSED
 *   praxis_http_requests_total{method,route,status}
 *   praxis_http_request_duration_seconds{method,route}
 *   praxis_db_query_duration_seconds / praxis_db_slow_queries_total
 *   praxis_jobs_total{queue,outcome} / praxis_job_duration_seconds{queue}
 *   praxis_auth_failures_total{reason} / praxis_rbac_denials_total{module,action}
 *   praxis_worker_errors_total{queue}
 *   process uptime + heap
 *
 * ACCESS. Metrics are operational, not secret — no tenant data, no PII, and
 * routes are templated so no ids leak. But an open scrape endpoint on the
 * public internet is still a free capacity-planning gift to anyone curious, so
 * it is bound behind a shared token when METRICS_TOKEN is set, and open when it
 * is not (a private network, or local development). Unset is the honest default
 * for a single-VPS deployment where the scraper is on the same host.
 */
"use strict";

const express = require("express");
const { config } = require("../config/env");
const metrics = require("../shared/observability/metrics");

const router = express.Router();

router.get("/metrics", (req, res) => {
  if (config.METRICS_TOKEN) {
    const given = req.get("authorization") || "";
    const expected = `Bearer ${config.METRICS_TOKEN}`;
    // Length-independent compare is overkill for a scrape token, but a plain
    // !== leaks length via timing and costs nothing to avoid.
    if (given.length !== expected.length || given !== expected) {
      return res.status(401).type("text/plain").send("unauthorized\n");
    }
  }
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.send(metrics.render());
});

module.exports = { router };
