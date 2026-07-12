#!/usr/bin/env node
/**
 * Self-learn backfill — build the AI knowledge corpora from scratch (or refresh).
 *   node scripts/ai/reindex.js --global                 # codebase + docs + platform schema
 *   node scripts/ai/reindex.js --tenant=smartls         # tenant schema cards + entity cards (live)
 *   node scripts/ai/reindex.js --all                    # global + every tenant
 * Idempotent: unchanged content is skipped (content_hash).
 */
"use strict";

const { config } = require("../../src/config/env");
const m = require("../../src/services/platform/migrator");
const codebase = require("../../src/services/ai/knowledge/codebase");
const { buildSchemaCards } = require("../../src/services/ai/knowledge/schema-introspect");
const { buildEntityCards } = require("../../src/services/ai/knowledge/entity-cards");
const ingest = require("../../src/services/ai/ingest.service");
const provisioning = require("../../src/services/platform/provisioning.service");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

async function reindexGlobal() {
  const items = codebase.collect();
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const cards = await buildSchemaCards(pf, "platform");
    for (const c of cards) items.push({ kind: "platform_schema", ref: c.ref, title: c.title, content: c.text });
  } finally {
    await pf.end();
  }
  const r = await ingest.ingestGlobal(items);
  console.log(`[praxis-ai] global: ${r.changed}/${r.total} sources (re)indexed`);
}

async function reindexTenant(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    await cli.query("SET search_path = live, public");
    const cards = [
      ...(await buildSchemaCards(cli, "live")).map((c) => ({ ref: c.ref, title: c.title, text: c.text, confidentiality: "normal" })),
      ...(await buildEntityCards(cli)),
    ];
    const r = await ingest.ingestTenantCards(cli, cards);
    if (r.skipped) console.log(`[praxis-ai] tenant ${slug}: skipped (${r.skipped})`);
    else console.log(`[praxis-ai] tenant ${slug}: ${r.cards} cards indexed`);
  } finally {
    await cli.end();
  }
}

(async () => {
  if (a.global || a.all) await reindexGlobal();
  if (a.tenant) await reindexTenant(a.tenant);
  if (a.all) {
    for (const slug of await provisioning.listTenantSlugs()) await reindexTenant(slug);
  }
  if (!a.global && !a.tenant && !a.all) {
    console.log("usage: reindex.js --global | --tenant=<slug> | --all");
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-ai] reindex FAILED:", e.message);
    process.exit(1);
  });
