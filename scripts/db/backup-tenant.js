#!/usr/bin/env node
/**
 * WS-B1 — run a tenant backup by hand, or check the fleet's backup freshness.
 *
 *   node scripts/db/backup-tenant.js --status            # freshness per tenant
 *   node scripts/db/backup-tenant.js --all               # back up every LIVE tenant
 *   node scripts/db/backup-tenant.js --slug=acme         # one tenant
 *   node scripts/db/backup-tenant.js --prune             # apply retention
 *
 * `--status` exits 1 when any tenant is stale or has never been backed up, so it
 * works as a deploy gate or a monitoring check, not just something to read.
 */
"use strict";

const backup = require("../../src/services/platform/backup.service");
const store = require("../../src/services/platform/backup-storage.service");
const objects = require("../../src/services/platform/object-backup.service");
const registry = require("../../src/services/tenant/registry.service");
const platformDb = require("../../src/services/platform/db");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const JSON_OUT = has("--json");

async function cmdStatus() {
  const s = await backup.backupStatus();
  if (JSON_OUT) {
    console.warn(JSON.stringify(s, null, 2));
    return s.stale_count === 0;
  }
  const w = Math.max(6, ...s.tenants.map((t) => t.slug.length));
  // `describe()` rather than a constant: the destination is configurable from
  // the console now, so an operator running this wants to see where backups are
  // ACTUALLY going — and whether that came from the vault or from .env.
  const dest = await store.describe();
  console.warn(
    `Backup freshness (RPO ${s.rpo_hours}h, driver ${dest.driver} → ${dest.destination}, from ${dest.source})\n`,
  );
  console.warn(`${"tenant".padEnd(w)}  last good backup      age     size`);
  console.warn("-".repeat(w + 42));
  for (const t of s.tenants) {
    if (t.never_backed_up) {
      console.warn(`${t.slug.padEnd(w)}  NEVER BACKED UP`);
      continue;
    }
    const flag = t.stale ? "  <-- STALE" : "";
    const mb = t.last_ok_bytes ? `${(Number(t.last_ok_bytes) / 1048576).toFixed(1)}MB` : "-";
    console.warn(
      `${t.slug.padEnd(w)}  ${new Date(t.last_ok_at).toISOString().slice(0, 16)}  ` +
        `${String(t.age_hours).padStart(6)}h  ${mb.padStart(8)}${flag}`,
    );
  }
  console.warn(
    s.stale_count
      ? `\n${s.stale_count} tenant(s) outside the RPO, ${s.never_count} never backed up.`
      : "\nEvery live tenant has a backup inside the RPO.",
  );
  return s.stale_count === 0;
}

(async () => {
  try {
    if (has("--preflight")) {
      const p = await backup.preflight();
      console.warn(`pg_dump    : ${p.pg_dump || "NOT FOUND"}`);
      console.warn(`pg_restore : ${p.pg_restore || "NOT CHECKED"}`);
      console.warn(`server     : ${p.server || "unknown"}`);
      console.warn(p.ok ? "\nBackup tooling OK." : `\nNOT USABLE — ${p.error}`);
      process.exitCode = p.ok ? 0 : 1;
    } else if (has("--status")) {
      process.exitCode = (await cmdStatus()) ? 0 : 1;
    } else if (has("--prune")) {
      const r = await store.pruneRetention();
      console.warn(`pruned ${r.removed.length} expired backup(s); ${r.kept} kept.`);
    } else if (has("--objects")) {
      const r = await objects.syncFleetObjects();
      console.warn(
        `${r.ok}/${r.total} tenant(s) synced, ${r.copied} object(s) copied` +
          (r.missing ? `, ${r.missing} referenced but ABSENT from storage` : ""),
      );
      process.exitCode = r.failed || r.missing ? 1 : 0;
    } else if (has("--scan")) {
      const r = await objects.scanFleetIntegrity();
      console.warn(
        `${r.clean}/${r.total} tenant(s) clean` +
          (r.missing || r.corrupt ? ` — ${r.missing} missing, ${r.corrupt} CORRUPT` : ""),
      );
      for (const t of r.results.filter((x) => !x.ok)) {
        for (const f of t.findings.corrupt || []) {
          console.warn(`  CORRUPT ${t.slug} ${f.storage_path} (expected ${String(f.expected).slice(0, 12)}…)`);
        }
        for (const f of t.findings.missing || []) {
          console.warn(`  MISSING ${t.slug} ${f.storage_path}`);
        }
      }
      process.exitCode = r.missing || r.corrupt ? 1 : 0;
    } else if (has("--all")) {
      const r = await backup.backupFleet();
      console.warn(`${r.ok}/${r.total} succeeded in ${(r.duration_ms / 1000).toFixed(1)}s.`);
      if (r.failed) console.warn(`FAILED: ${r.failed_slugs.join(", ")}`);
      process.exitCode = r.failed ? 1 : 0;
    } else {
      const slug = val("slug");
      if (!slug) {
        console.warn("usage: --status | --all | --slug=<tenant> | --prune");
        process.exitCode = 2;
        return;
      }
      const metas = await registry.listActiveTenants();
      const meta = metas.find((t) => t.slug === slug);
      if (!meta) throw new Error(`no live tenant "${slug}"`);
      const r = await backup.backupTenant(meta);
      console.warn(
        r.ok
          ? `ok — ${r.location} (${(r.bytes / 1048576).toFixed(1)}MB in ${(r.duration_ms / 1000).toFixed(1)}s)`
          : `FAILED — ${r.error}`,
      );
      process.exitCode = r.ok ? 0 : 1;
    }
  } catch (err) {
    console.warn(`error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await registry.closeAll().catch(() => {});
    await platformDb.close().catch(() => {});
  }
})();
