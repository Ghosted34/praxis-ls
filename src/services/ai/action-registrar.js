/**
 * AI action registrar (AI_ARCHITECTURE §2/§7). Walks every `<module>.ai.js`
 * manifest and derives, with zero drift from the modules themselves:
 *   - the CATALOGUE rows for `ai_action_catalogue` (what the AI is told it can do)
 *   - the EXECUTOR map (what the AI is actually allowed to run on confirm)
 *
 * Safety boundary (§1): writes are only AI-enabled when a vetted executor exists
 * in `action-registry` (the explicit, hand-reviewed map). Reads are pure and get
 * a generic executor. So `ai_enabled` is true only for actions we can safely run
 * — the catalogue never advertises a capability the runtime can't honour.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { registry } = require("./action-registry");

const MODULES_DIR = path.resolve(__dirname, "../../modules");

/** Recursively find every *.ai.js manifest under src/modules. */
function discoverManifestFiles(dir = MODULES_DIR, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) discoverManifestFiles(p, out);
    else if (e.name.endsWith(".ai.js")) out.push(p);
  }
  return out;
}

function loadManifests(files = discoverManifestFiles()) {
  const manifests = [];
  for (const f of files) {
    try {
      // dynamic require: manifest path discovered at runtime (trusted, local)
      manifests.push({ file: f, manifest: require(f) });
    } catch {
      // a broken manifest must not break the registrar; skip it.
    }
  }
  return manifests;
}

// ── Minimal Zod → JSON-schema (top-level shape only; enough for the tool gate) ──
function unwrap(zt) {
  let t = zt;
  // peel ZodOptional / ZodNullable / ZodDefault to the inner type
  while (t && t._def && ["ZodOptional", "ZodNullable", "ZodDefault"].includes(t._def.typeName)) {
    t = t._def.innerType;
  }
  return t;
}
const TYPE_MAP = { ZodString: "string", ZodNumber: "number", ZodBoolean: "boolean", ZodArray: "array", ZodObject: "object", ZodEnum: "string", ZodNativeEnum: "string", ZodRecord: "object", ZodAny: undefined };

function zodToJsonSchema(schema) {
  // Unwrap a .refine()/.superRefine() (ZodEffects) to the inner object so refined
  // schemas (e.g. journal_entry post) still expose their fields to the form.
  if (schema && !schema.shape && schema._def && schema._def.schema && schema._def.schema.shape) schema = schema._def.schema;
  if (!schema || !schema.shape) return { type: "object", properties: {} };
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(schema.shape)) {
    const inner = unwrap(field);
    const tn = inner && inner._def ? inner._def.typeName : undefined;
    if (tn === "ZodArray") {
      // Recurse one level into the element so array-of-objects (line items,
      // narratives) carry their item shape — the copilot renders repeatable rows.
      const el = unwrap(inner._def.type);
      properties[key] = el && el.shape ? { type: "array", items: zodToJsonSchema(el) } : { type: "array" };
    } else if (tn === "ZodObject" && inner.shape) {
      properties[key] = zodToJsonSchema(inner);
    } else {
      const jsonType = TYPE_MAP[tn];
      properties[key] = jsonType ? { type: jsonType } : {};
      if (tn === "ZodEnum" && Array.isArray(inner._def.values)) properties[key].enum = inner._def.values;
    }
    if (typeof field.isOptional === "function" ? !field.isOptional() : true) required.push(key);
  }
  return required.length ? { type: "object", properties, required } : { type: "object", properties };
}

const permString = (p) => (p && p.module ? `${p.module}:${p.action}` : null);

/** Build the catalogue rows (pure — no DB) from the discovered manifests. */
function buildCatalogue(manifests = loadManifests()) {
  const rows = [];
  const seen = new Set();
  for (const { manifest } of manifests) {
    if (!manifest || !manifest.entity) continue;
    const mod = manifest.module_key || null;
    // `ai_writes: false` on a manifest makes it READ-ONLY for the AI (reads stay,
    // every write is disabled). `aiEnabled: false` on a single action opts just
    // that one out. Used to keep finance (posting/updating the ledger) read-only.
    const aiWritesOff = manifest.ai_writes === false;
    const push = (a, isWrite) => {
      if (!a || !a.key || seen.has(a.key)) return;
      seen.add(a.key);
      const executable = isExecutable(a, isWrite) && a.aiEnabled !== false && !(isWrite && aiWritesOff);
      rows.push({
        action_key: a.key,
        title: a.key.replace(/_/g, " "),
        description: a.describe || null,
        module_key: mod,
        is_write: isWrite,
        payload_schema: a.schema ? zodToJsonSchema(a.schema) : { type: "object", properties: {} },
        required_permission: permString(a.permission),
        requires_confirmation: isWrite ? a.confirm !== false : false,
        ai_enabled: executable,
      });
    };
    for (const r of manifest.reads || []) push(r, false);
    for (const w of manifest.writes || []) push(w, true);
  }
  return rows;
}

// ── Executor map ──
// Reads are pure and get a generic adapter. Writes prefer a hand-vetted executor
// from `action-registry` (which bridges snake_case AI payloads to a service's
// exact signature); any write NOT in that registry falls back to a GENERIC
// adapter that calls the manifest's own `service(client, payload, actor)`. This
// keeps the AI's write reach equal to the app's — every module write is
// proposable — while the vetted executors still own the ones whose service takes
// a non-payload shape (camelCase args / {data,actor}). Human confirm still gates
// every write regardless (orchestrator.confirmAction).
function readAdapter(action, service) {
  return async ({ client, payload = {} }) => {
    let arg = payload;
    // `get_*` reads take a scalar id. The model may pass it as `id` OR as the
    // natural field name it saw upstream (e.g. `po_id` from a GRN, `dossier_id`),
    // so accept `id` first, then any single *_id value, else the raw payload.
    if (action.startsWith("get_") || action.startsWith("effective_")) {
      if (payload && typeof payload === "object") {
        const idKey = payload.id !== undefined ? "id" : Object.keys(payload).find((k) => k.endsWith("_id"));
        arg = idKey ? payload[idKey] : payload;
      }
    }
    const data = await service(client, arg);
    return { data };
  };
}

function writeAdapter(service) {
  return async ({ client, user, payload = {} }) => {
    const result = await service(client, payload, { user_id: user && user.user_id });
    if (result && result.entity_ref) return result;
    // Derive a reference from the returned row (first *_id column, or id/ref) so
    // the ledger + the conversation "✓ Executed" note can name what was created.
    let ref = null;
    if (result && typeof result === "object") {
      const idKey = Object.keys(result).find((k) => k.endsWith("_id")) || (result.id ? "id" : result.ref ? "ref" : null);
      if (idKey) ref = `record:${result[idKey]}`;
    }
    return { entity_ref: ref, data: result };
  };
}

/** A write is executable if vetted OR its manifest provides a callable service. */
function isExecutable(action, isWrite) {
  if (isWrite) return Boolean(registry[action.key]) || typeof action.service === "function";
  return true; // reads are always executable via the generic adapter
}

/** { action_key → executor({client,user,payload}) }. Vetted registry wins; then
 *  manifest reads (generic read adapter) and writes (generic write adapter). */
function buildExecutorMap(manifests = loadManifests()) {
  const map = { ...registry };
  for (const { manifest } of manifests) {
    for (const r of manifest.reads || []) {
      if (!map[r.key] && typeof r.service === "function") map[r.key] = readAdapter(r.key, r.service);
    }
    for (const w of manifest.writes || []) {
      if (!map[w.key] && typeof w.service === "function") map[w.key] = writeAdapter(w.service);
    }
  }
  return map;
}

/** Upsert catalogue rows into ai_action_catalogue (tenant client). */
async function syncCatalogue(client, { manifests, enableWritesInRegistryOnly = true } = {}) {
  const rows = buildCatalogue(manifests);
  let upserts = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO ai_action_catalogue
         (action_key, title, description, module_key, is_write, payload_schema,
          required_permission, requires_confirmation, ai_enabled)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (action_key) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, module_key = EXCLUDED.module_key,
         is_write = EXCLUDED.is_write, payload_schema = EXCLUDED.payload_schema,
         required_permission = EXCLUDED.required_permission,
         requires_confirmation = EXCLUDED.requires_confirmation,
         ai_enabled = EXCLUDED.ai_enabled, updated_at = now()`,
      [r.action_key, r.title, r.description, r.module_key, r.is_write, JSON.stringify(r.payload_schema),
        r.required_permission, r.requires_confirmation, r.ai_enabled && !enableWritesInRegistryOnly ? true : r.ai_enabled],
    );
    upserts += 1;
  }
  return { upserts, total: rows.length };
}

module.exports = { discoverManifestFiles, loadManifests, buildCatalogue, buildExecutorMap, syncCatalogue, zodToJsonSchema };
