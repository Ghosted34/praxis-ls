/**
 * In-process metrics registry, exposed at `GET /api/metrics` in Prometheus text
 * format.
 *
 * Audit OBS-M1 (Critical): "No metrics of any kind, no dashboard, no baseline."
 * Also carries OBS-T2 (no timing recorded anywhere), OBS-M3 (slow queries warn
 * but are never measured), OBS-A5 (the worker is entirely unmonitored) and
 * OBS-A7 (failed jobs accumulate unwatched) — those four are all "the number
 * exists nowhere", and one registry answers all of them.
 *
 * WHY HAND-ROLLED AND NOT prom-client
 *
 *   prom-client is the obvious choice and would be right for a bigger surface.
 *   It is a new production dependency for four counters and two histograms, on
 *   a project whose immediate problem is that NOTHING is measured. This is
 *   ~150 lines with no dependency, emits the same text format, and can be
 *   swapped for prom-client later without touching a single call site — the
 *   call sites only ever see `inc()` and `observe()`.
 *
 * WHAT IT IS NOT
 *
 *   Not durable. Counters reset when the process restarts, which is normal for
 *   Prometheus-style metrics: the scraper handles resets, and `_created`
 *   timestamps let a query detect one.
 *
 *   Not per-tenant on the HTTP path. Tenant is a high-cardinality label and a
 *   thousand tenants times a dozen routes is a cardinality explosion that will
 *   take the scraper down. Tenant lives on log lines (OBS-L3), where cardinality
 *   is free. Business metrics that genuinely need it are counted per tenant
 *   deliberately and only where the set is small.
 *
 * ROUTE LABELS ARE TEMPLATED, NOT RAW PATHS. `/invoices/:id` — never
 * `/invoices/8f2c…`. A raw path label is the classic way to make a metrics
 * endpoint that itself brings down the monitoring.
 */

"use strict";

/** name -> { help, type, values: Map<labelKey, number>, labelNames } */
const counters = new Map();
/** name -> { help, buckets, values: Map<labelKey, {counts:[], sum, count}> } */
const histograms = new Map();

const STARTED_AT = Date.now();

/** Default latency buckets, in seconds. Tuned for an HTTP API, not a batch job. */
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelKey(labels = {}) {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return "";
  return keys.map((k) => `${k}=${String(labels[k]).replace(/[\\"\n]/g, "_")}`).join(",");
}

function parseKey(key) {
  if (!key) return {};
  const out = {};
  for (const pair of key.split(",")) {
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

function counter(name, help) {
  if (!counters.has(name)) counters.set(name, { help, values: new Map() });
  return counters.get(name);
}

function histogram(name, help, buckets = DEFAULT_BUCKETS) {
  if (!histograms.has(name)) {
    histograms.set(name, { help, buckets, values: new Map() });
  }
  return histograms.get(name);
}

/** Increment a counter. Creates it on first use. */
function inc(name, labels = {}, value = 1, help = "") {
  const c = counter(name, help);
  const k = labelKey(labels);
  c.values.set(k, (c.values.get(k) || 0) + value);
}

/** Record an observation, in SECONDS. */
function observe(name, seconds, labels = {}, help = "") {
  const h = histogram(name, help);
  const k = labelKey(labels);
  let v = h.values.get(k);
  if (!v) {
    v = { counts: new Array(h.buckets.length).fill(0), sum: 0, count: 0 };
    h.values.set(k, v);
  }
  v.count += 1;
  v.sum += seconds;
  for (let i = 0; i < h.buckets.length; i++) {
    if (seconds <= h.buckets[i]) v.counts[i] += 1;
  }
}

/**
 * Collapse a URL path to a low-cardinality route label.
 *
 * `/api/tenant/invoices/8f2c.../lines` -> `/api/tenant/invoices/:id/lines`
 * Without this every uuid becomes its own time series and the scraper dies.
 */
function templatePath(p) {
  return String(p || "/")
    .split("?")[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+/g, "/:id")
    .slice(0, 120);
}

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function renderLabels(labels) {
  const entries = Object.entries(labels);
  if (!entries.length) return "";
  return `{${entries.map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}`;
}

/** Prometheus text exposition format. */
function render() {
  const out = [];

  out.push("# HELP praxis_process_uptime_seconds Seconds since this process started.");
  out.push("# TYPE praxis_process_uptime_seconds gauge");
  out.push(`praxis_process_uptime_seconds ${((Date.now() - STARTED_AT) / 1000).toFixed(0)}`);

  const mem = process.memoryUsage();
  out.push("# HELP praxis_process_heap_bytes Resident heap in bytes.");
  out.push("# TYPE praxis_process_heap_bytes gauge");
  out.push(`praxis_process_heap_bytes ${mem.heapUsed}`);

  for (const [name, c] of counters) {
    if (c.help) out.push(`# HELP ${name} ${esc(c.help)}`);
    out.push(`# TYPE ${name} counter`);
    for (const [k, v] of c.values) out.push(`${name}${renderLabels(parseKey(k))} ${v}`);
  }

  for (const [name, h] of histograms) {
    if (h.help) out.push(`# HELP ${name} ${esc(h.help)}`);
    out.push(`# TYPE ${name} histogram`);
    for (const [k, v] of h.values) {
      const labels = parseKey(k);
      for (let i = 0; i < h.buckets.length; i++) {
        out.push(`${name}_bucket${renderLabels({ ...labels, le: h.buckets[i] })} ${v.counts[i]}`);
      }
      out.push(`${name}_bucket${renderLabels({ ...labels, le: "+Inf" })} ${v.count}`);
      out.push(`${name}_sum${renderLabels(labels)} ${v.sum.toFixed(6)}`);
      out.push(`${name}_count${renderLabels(labels)} ${v.count}`);
    }
  }

  return out.join("\n") + "\n";
}

/** Snapshot for the readiness probe and tests. */
function snapshot() {
  const out = { counters: {}, histograms: {} };
  for (const [name, c] of counters) {
    out.counters[name] = Object.fromEntries(c.values);
  }
  for (const [name, h] of histograms) {
    out.histograms[name] = Object.fromEntries(
      [...h.values].map(([k, v]) => [k, { count: v.count, sum: Number(v.sum.toFixed(6)) }]),
    );
  }
  return out;
}

function __reset() {
  counters.clear();
  histograms.clear();
}

module.exports = {
  inc,
  observe,
  render,
  snapshot,
  templatePath,
  __reset,
  DEFAULT_BUCKETS,
};
