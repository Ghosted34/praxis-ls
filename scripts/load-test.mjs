#!/usr/bin/env node
/**
 * G11 — load test against a running tenant API.
 *
 * PRD §14 targets p95 < 400 ms at 20–50 concurrent users per tenant. This
 * script answers that for real: N concurrent agents hammering the read-heavy
 * surfaces a logged-in user actually touches, with per-request latency stats.
 *
 * Usage:
 *   node scripts/load-test.mjs --url=https://acme.praxisls.com \
 *       --token=<access-token> --users=30 --duration=30
 *
 * Dependencies: Node 18+ (global fetch). No k6/artillery install needed.
 * The token must belong to a user whose grants cover the paths below; a 403
 * shows up as a failed request, which is itself useful signal.
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);

const BASE = String(args.url || "").replace(/\/+$/, "");
const TOKEN = args.token || "";
const USERS = Math.min(Number(args.users) || 20, 200);
const DURATION_S = Number(args.duration) || 30;

if (!BASE) {
  console.error("usage: node scripts/load-test.mjs --url=<base> --token=<t> [--users=30] [--duration=30]");
  process.exit(1);
}

/** The read surfaces a signed-in user opens in the first minutes of a session. */
const ENDPOINTS = [
  ["GET", "/api/tenant/whoami"],
  ["GET", "/api/tenant/notifications/unread-count"],
  ["GET", "/api/tenant/dashboard/kpis"],
  ["GET", "/api/tenant/operations/files"],
  ["GET", "/api/tenant/sales/opportunities"],
  ["GET", "/api/tenant/finance/invoices"],
  ["GET", "/api/tenant/hr/employees"],
];

const results = [];
let running = true;

async function agent(id) {
  const started = Date.now();
  while (running) {
    const [method, path] = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "X-Praxis-Env": "live",
          "Content-Type": "application/json",
        },
      });
      const ms = performance.now() - t0;
      results.push({ ok: res.ok, status: res.status, ms });
    } catch (e) {
      results.push({ ok: false, status: 0, ms: performance.now() - t0 });
    }
    // A natural think time between requests, like a human moving between pages.
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 600));
  }
  return Date.now() - started;
}

const agents = Array.from({ length: USERS }, (_, i) => agent(i));
setTimeout(() => { running = false; }, DURATION_S * 1000);

Promise.all(agents).then(() => {
  const n = results.length;
  const ok = results.filter((r) => r.ok && r.status < 400).length;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
  const avg = lat.reduce((a, b) => a + b, 0) / (n || 1);
  console.log(`\n── load test (${USERS} users, ${DURATION_S}s) ────────────────`);
  console.log(`requests:    ${n}`);
  console.log(`success:     ${ok}/${n} (${((ok / (n || 1)) * 100).toFixed(1)}%)`);
  console.log(`latency avg: ${avg.toFixed(0)} ms`);
  console.log(`latency p50: ${pct(50).toFixed(0)} ms`);
  console.log(`latency p95: ${pct(95).toFixed(0)} ms  ← PRD §14 target: < 400 ms`);
  console.log(`latency p99: ${pct(99).toFixed(0)} ms`);
  process.exit(ok / (n || 1) >= 0.95 && pct(95) < 400 ? 0 : 1);
});
