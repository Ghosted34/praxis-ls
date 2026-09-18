#!/usr/bin/env node
/**
 * Rebuild ai_action_catalogue from the *.ai.js manifests (AI_ARCHITECTURE §2).
 *   node scripts/ai/sync-actions.js --tenant=smartls     # one tenant (live + sandbox)
 *   node scripts/ai/sync-actions.js --all                # every provisioned tenant
 *   node scripts/ai/sync-actions.js --dry                # print the catalogue, no writes
 *   node scripts/ai/sync-actions.js --check              # drift check, no DB, CI-safe
 *   node scripts/ai/sync-actions.js --check --tenant=x   # also diff the LIVE rows
 * Idempotent upsert by action_key; ai_enabled follows the executor registry so
 * the catalogue never advertises a capability the runtime can't safely run.
 *
 * ── WHY `--check` EXISTS (audit I2) ────────────────────────────────────────
 *
 * `AI_ARCHITECTURE.md` §2 claimed "adding/removing a module updates the
 * catalogue automatically → no drift". It did not: the catalogue is only as
 * fresh as the last time somebody ran this script, and nothing verified that the
 * manifests it is built from were internally consistent. A manifest could
 * advertise an action with no executor, two modules could claim the same
 * `action_key`, or a write could name a permission the RBAC layer has no column
 * for — and the first sign of any of it was the assistant failing at runtime.
 *
 * `--check` splits that into the half CI can honestly run and the half it
 * cannot:
 *
 *   · WITHOUT `--tenant` (what CI runs): the MANIFEST-SIDE checks. No database,
 *     no network. Every catalogue row is derivable, every key is unique, every
 *     enabled action resolves to an executor, every write declares a schema and
 *     a permission whose verb the authz layer knows. These are the failures that
 *     are properties of the code, so they belong in the build.
 *
 *   · WITH `--tenant=<slug>` (a DB job, or by hand before a deploy): everything
 *     above, PLUS a diff of the derived catalogue against the rows actually in
 *     `ai_action_catalogue` — in BOTH the `live` and `sandbox` schemas (audit
 *     I4: sandbox was not being synced, which is why an action could work in
 *     LIVE and be missing in TEST). It reports what a sync would add, remove or
 *     change, and exits non-zero if anything would.
 *
 * Neither mode writes. `--check` is a question, not a repair.
 */
"use strict";

const m = require("../../src/services/platform/migrator");
const provisioning = require("../../src/services/platform/provisioning.service");
const registrar = require("../../src/services/ai/action-registrar");
const { registry } = require("../../src/services/ai/action-registry");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

/**
 * The schemas a tenant's business data is served from. `live` always; `sandbox`
 * only where it has been provisioned. Both, because `ai_action_catalogue` lives
 * beside the business rows and `X-Praxis-Env` picks which copy a request reads
 * (see middleware/tenant-context) — a live-only sync left the TEST copilot with
 * nothing but the seed actions.
 */
async function schemasOf(cli) {
  const schemas = ["live"];
  const { rows } = await cli.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'sandbox'");
  if (rows.length) schemas.push("sandbox");
  return schemas;
}

async function syncTenant(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    for (const schema of await schemasOf(cli)) {
      await cli.query(`SET search_path = ${schema}, public`);
      const r = await registrar.syncCatalogue(cli);
      console.warn(`[praxis-ai] tenant ${slug} (${schema}): ${r.upserts}/${r.total} catalogue actions synced`);
    }
  } finally {
    await cli.end();
  }
}

/* ── --check ──────────────────────────────────────────────────────────────── */

/**
 * Executors that deliberately belong to no module, with the reason. The check
 * below flags a vetted executor no manifest declares, because that is normally a
 * key the catalogue dropped — one that can never run again and that the next
 * reader of `action-registry` will believe still works. An entry here is a
 * decision that it is not that.
 */
const NOT_CATALOGUED = {
  ping: "a self-test executor with no module and no business effect — it echoes its own payload. Deliberately absent from the catalogue so it is never offered to the model.",
};

// Mirrors `services/ai/action-authz.COLUMN`. A permission verb outside this set
// cannot be checked, and that layer fails CLOSED — so the action would be
// catalogued, advertised, and refused. Better to say so at build time.
const KNOWN_VERBS = new Set(["view", "read", "create", "edit", "update", "delete", "approve", "export", "validate", "disburse", "publish"]);

/** Manifest-side consistency. No DB. Returns a list of problem strings. */
function checkManifests() {
  const problems = [];
  const manifests = registrar.loadManifests();

  // Every discovered file must have PARSED. `loadManifests` swallows a broken
  // manifest on purpose (one bad file must not take the registrar down at
  // boot), which is right at runtime and wrong in CI: here it is the whole
  // point. So the two counts are compared.
  const files = registrar.discoverManifestFiles();
  if (manifests.length !== files.length) {
    const loaded = new Set(manifests.map((x) => x.file));
    for (const f of files.filter((x) => !loaded.has(x))) {
      let why = "unknown error";
      try { require(f); } catch (e) { why = e.message; }
      problems.push(`manifest does not load: ${f}\n      ${why}`);
    }
  }

  const seen = new Map();
  for (const { file, manifest } of manifests) {
    if (!manifest || !manifest.entity) { problems.push(`manifest has no \`entity\`: ${file}`); continue; }
    for (const [kind, list] of [["read", manifest.reads || []], ["write", manifest.writes || []]]) {
      for (const act of list) {
        if (!act || !act.key) { problems.push(`${kind} with no \`key\` in ${file}`); continue; }
        if (seen.has(act.key)) problems.push(`duplicate action_key \`${act.key}\`: ${seen.get(act.key)} and ${file}`);
        else seen.set(act.key, file);
        if (kind === "write") {
          if (!act.schema) problems.push(`write \`${act.key}\` declares no schema (${file})`);
          const p = act.permission;
          if (!p || !p.module || !p.action) {
            // action-authz fails closed on a null requirement, so this is not a
            // lax action — it is a dead one.
            problems.push(`write \`${act.key}\` has no { module, action } permission, so authz will refuse it (${file})`);
          } else if (!KNOWN_VERBS.has(p.action)) {
            problems.push(`write \`${act.key}\` uses permission verb \`${p.action}\`, which action-authz cannot map (${file})`);
          }
        }
      }
    }
  }

  // The catalogue must be derivable, and everything it advertises must run.
  let rows = [];
  try {
    rows = registrar.buildCatalogue(manifests);
  } catch (e) {
    problems.push(`buildCatalogue threw: ${e.message}`);
    return { problems, rows };
  }
  const executors = registrar.buildExecutorMap(manifests);
  for (const r of rows.filter((x) => x.ai_enabled)) {
    if (typeof executors[r.action_key] !== "function") {
      problems.push(`\`${r.action_key}\` is ai_enabled but resolves to no executor`);
    }
  }
  // The hand-vetted registry must not name an action the manifests dropped: a
  // stale executor is a key the catalogue no longer carries, so it can never
  // run, and the next person to read `action-registry` will believe it can.
  const catalogued = new Set(rows.map((r) => r.action_key));
  for (const key of Object.keys(registry)) {
    if (!catalogued.has(key) && !NOT_CATALOGUED[key]) {
      problems.push(`action-registry has a vetted executor for \`${key}\`, which no manifest declares`);
    }
  }
  return { problems, rows };
}

/** Diff the derived catalogue against one tenant schema's rows. */
async function checkTenant(slug, rows) {
  const problems = [];
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    for (const schema of await schemasOf(cli)) {
      await cli.query(`SET search_path = ${schema}, public`);
      const { rows: live } = await cli.query(
        "SELECT action_key, is_write, required_permission, requires_confirmation, ai_enabled FROM ai_action_catalogue",
      );
      const byKey = new Map(live.map((r) => [r.action_key, r]));
      const derived = new Map(rows.map((r) => [r.action_key, r]));
      for (const [key, want] of derived) {
        const got = byKey.get(key);
        if (!got) { problems.push(`${slug}/${schema}: \`${key}\` is missing from ai_action_catalogue`); continue; }
        for (const col of ["is_write", "required_permission", "requires_confirmation", "ai_enabled"]) {
          if (String(got[col]) !== String(want[col])) {
            problems.push(`${slug}/${schema}: \`${key}\`.${col} is ${got[col]}, manifests say ${want[col]}`);
          }
        }
      }
      for (const key of byKey.keys()) {
        if (!derived.has(key)) problems.push(`${slug}/${schema}: \`${key}\` is in ai_action_catalogue but no manifest declares it`);
      }
      console.warn(`[praxis-ai] checked ${slug} (${schema}): ${live.length} catalogued vs ${rows.length} derived`);
    }
  } finally {
    await cli.end();
  }
  return problems;
}

async function runCheck() {
  const { problems, rows } = checkManifests();
  if (a.tenant && !problems.length) problems.push(...(await checkTenant(a.tenant, rows)));

  if (problems.length) {
    console.error("\nAI CATALOGUE DRIFT\n");
    for (const p of problems) console.error(`  · ${p}`);
    console.error(`
${problems.length} problem(s). A manifest-side failure is fixed in the module's
\`<module>.ai.js\`; a tenant-side one is fixed by running the sync:

    node scripts/ai/sync-actions.js --tenant=<slug>     (or --all)
`);
    process.exit(1);
  }
  const writes = rows.filter((r) => r.is_write).length;
  console.warn(
    `[praxis-ai] catalogue ok — ${rows.length} actions (${writes} writes, ${rows.filter((r) => r.ai_enabled).length} ai_enabled)` +
    (a.tenant ? `, in step with ${a.tenant}` : ", manifest-side (no tenant checked)"),
  );
}

async function main() {
  if (a.check) return runCheck();
  if (a.dry) {
    const rows = registrar.buildCatalogue();
    console.warn(`[praxis-ai] ${rows.length} actions (${rows.filter((r) => r.is_write).length} writes, ${rows.filter((r) => r.ai_enabled).length} ai_enabled)`);
    for (const r of rows) console.warn(`  ${r.ai_enabled ? "•" : " "} ${r.action_key}${r.is_write ? " [write]" : ""}${r.required_permission ? " (" + r.required_permission + ")" : ""}`);
    return;
  }
  if (a.tenant) return syncTenant(a.tenant);
  if (a.all) {
    const slugs = await provisioning.listTenantSlugs();
    for (const s of slugs) await syncTenant(s); /// eslint-disable-line no-await-in-loop
    return;
  }
  console.error("usage: sync-actions.js --tenant=<slug> | --all | --dry | --check [--tenant=<slug>]");
  process.exit(1);
}

main().catch((err) => { console.error("[praxis-ai] sync failed:", err.message); process.exit(1); });
