#!/usr/bin/env node
/**
 * Kaizen ops console, from the terminal (§3.1, §3.4, §3.5).
 *
 *   node scripts/db/ops-status.js                  # the fleet grid: who is RED
 *   node scripts/db/ops-status.js --sweep          # run a health sweep now
 *   node scripts/db/ops-status.js --uptime         # probe every host now
 *   node scripts/db/ops-status.js --availability   # 30-day availability + incidents
 *   node scripts/db/ops-status.js --objects        # object sync / integrity state
 *   node scripts/db/ops-status.js --alert-test     # prove the alert channel works
 *   node scripts/db/ops-status.js --maintenance    # scheduled windows
 *
 * Exits 1 when any tenant is RED or any host is down, so it doubles as a
 * monitoring check rather than only something to read.
 */
"use strict";

const health = require("../../src/services/platform/health-rollup.service");
const uptime = require("../../src/services/platform/uptime.service");
const objects = require("../../src/services/platform/object-backup.service");
const alerts = require("../../src/services/platform/alert-routing.service");
const maintenance = require("../../src/services/platform/maintenance.service");
const registry = require("../../src/services/tenant/registry.service");
const platformDb = require("../../src/services/platform/db");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const JSON_OUT = has("--json");

async function grid() {
  const f = await health.fleetHealth();
  if (JSON_OUT) {
    console.warn(JSON.stringify(f, null, 2));
    return f.red === 0;
  }
  const w = Math.max(6, ...f.tenants.map((t) => t.slug.length));
  console.warn(`${"tenant".padEnd(w)}  status  live(ms)  why`);
  console.warn("-".repeat(w + 46));
  for (const t of f.tenants) {
    const reasons = Array.isArray(t.reasons) ? t.reasons.join("; ") : "";
    console.warn(
      `${t.slug.padEnd(w)}  ${(t.status || "—").padEnd(6)}  ` +
        `${String(t.liveness_ms ?? "-").padStart(8)}  ${reasons}`,
    );
  }
  console.warn(
    `\n${f.red} RED, ${f.amber} AMBER, ${f.tenants.length - f.red - f.amber - f.unknown} GREEN` +
      (f.unknown ? `, ${f.unknown} never sampled` : ""),
  );
  return f.red === 0;
}

(async () => {
  let ok = true;
  try {
    if (has("--sweep")) {
      const r = await health.collectFleetHealth();
      console.warn(`swept ${r.total}: ${r.red} RED, ${r.amber} AMBER, ${r.green} GREEN`);
      ok = r.red === 0;
    } else if (has("--uptime")) {
      const r = await uptime.probeAll();
      for (const s of r.results) {
        console.warn(
          `${s.up ? "UP  " : "DOWN"}  ${s.host}  ${s.latency_ms ?? "-"}ms  ${s.error || ""}`,
        );
      }
      ok = r.down === 0;
    } else if (has("--availability")) {
      const av = await uptime.availability({ days: 30 });
      if (!av.length) {
        console.warn("No uptime samples yet — the probe has not run.");
      } else {
        console.warn("host                          avail%   samples  avg ms");
        console.warn("-".repeat(58));
        for (const a of av) {
          console.warn(
            `${a.host.padEnd(28)}  ${String(a.availability_pct ?? "-").padStart(6)}  ` +
              `${String(a.recorded).padStart(7)}  ${String(a.avg_latency_ms ?? "-").padStart(6)}`,
          );
        }
      }
      const inc = await uptime.incidents({ days: 30 });
      if (inc.length) {
        console.warn(`\n${inc.length} incident(s):`);
        for (const i of inc.slice(0, 10)) {
          console.warn(
            `  ${new Date(i.from).toISOString().slice(0, 16)}  ${i.host}  ` +
              `${i.duration_minutes}min  ${i.resolved ? "resolved" : "ONGOING"}`,
          );
        }
      }
    } else if (has("--objects")) {
      const rows = await objects.objectBackupStatus();
      console.warn("tenant      last sync            last integrity scan");
      console.warn("-".repeat(60));
      for (const r of rows) {
        console.warn(
          `${String(r.slug).padEnd(10)}  ` +
            `${r.last_sync_at ? new Date(r.last_sync_at).toISOString().slice(0, 16) : "never".padEnd(16)} ${r.last_sync_status || ""}  ` +
            `${r.last_scan_at ? new Date(r.last_scan_at).toISOString().slice(0, 16) : "never"} ${r.last_scan_status || ""}` +
            (r.last_scan_error ? `  (${r.last_scan_error})` : ""),
        );
      }
    } else if (has("--alert-test")) {
      const r = await alerts.raise({
        event: "maintenance.started",
        severity: "notify",
        subject: "Alert channel test from ops-status.js",
        detail: "If you can read this, the alert destination is configured and reachable.",
      });
      console.warn(
        r.delivered
          ? `delivered to the ${r.channel} channel.`
          : `NOT delivered — ${r.reason}. Set ALERT_WEBHOOK_URL.`,
      );
      ok = r.delivered;
    } else if (has("--maintenance")) {
      const rows = await maintenance.list();
      if (!rows.length) console.warn("No scheduled maintenance.");
      for (const m of rows) {
        console.warn(
          `${new Date(m.starts_at).toISOString().slice(0, 16)} → ${new Date(m.ends_at).toISOString().slice(0, 16)}  ` +
            `[${m.mode}] ${m.title}${m.tenant_id ? "" : "  (fleet-wide)"}`,
        );
      }
    } else {
      ok = await grid();
    }
  } catch (err) {
    console.warn(`error: ${err.message}`);
    ok = false;
  } finally {
    await registry.closeAll().catch(() => {});
    await platformDb.close().catch(() => {});
  }
  process.exitCode = ok ? 0 : 1;
})();
