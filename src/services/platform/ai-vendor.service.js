/**
 * Platform (deploy-wide) AI vendor credentials — ONE shared key set for every
 * tenant. Managed only from the platform console; the AI runtime reads decrypted
 * keys via getConfig(). Keys are AES-256-GCM encrypted at rest; HTTP reads never
 * expose the key, only its presence.
 *
 * This is also where the deployment says WHICH chat vendor answers first.
 * `is_chat_primary` marks one row (a partial unique index keeps it to one);
 * `llm.service.resolveChain` reads it through `getChatPrimary()` on every call
 * and puts that vendor at the head of the chain. It lives on the vendor row
 * rather than in `platform_setting` because it is an attribute of the vendor
 * the console already shows — the operator picks it on the same card that
 * holds the key, and the list endpoint carries it without a second read.
 */
"use strict";

const axios = require("axios");
const platformDb = require("./db");
const encryption = require("../encryption.service");
const { AppError } = require("../../utils/errors");
const { CHAT_VENDORS, DEFAULT_PRIMARY } = require("../ai/chat-vendors");

// Never selects api_key_enc — callers over HTTP only learn whether a key is set.
const SAFE = "vendor, display_name, endpoint_url, default_model, current_model, is_active, (api_key_enc IS NOT NULL) AS has_key, last_rotated_at, is_chat_primary";
const EDITABLE = ["display_name", "endpoint_url", "default_model", "current_model", "is_active"];

/**
 * `chat_capable` is computed, not stored: it is the runtime's list, and a
 * column would drift from it the first time a vendor was added to one and not
 * the other. The console uses it to offer "Use as primary" only where the
 * choice can work; `setChatPrimary` refuses the others regardless.
 */
function decorate(row) {
  if (!row) return row;
  return { ...row, chat_capable: CHAT_VENDORS.includes(row.vendor) };
}

async function list() {
  const { rows } = await platformDb.query(`SELECT ${SAFE} FROM ai_vendor_credential ORDER BY vendor`);
  return rows.map(decorate);
}

/** Upsert a vendor: apply editable fields, and rotate the key when apiKey given. */
async function set({ vendor, apiKey = null, patch = {}, actorId = null }) {
  const fields = {};
  for (const k of EDITABLE) if (patch[k] !== undefined) fields[k] = patch[k];
  if (apiKey) {
    fields.api_key_enc = encryption.encrypt(apiKey);
    fields.last_rotated_at = new Date().toISOString();
    fields.last_rotated_by = actorId;
  }
  // Defense-in-depth: only EDITABLE + key-rotation columns can be written.
  // The loop above already constrains to EDITABLE, but this catches any future
  // caller that bypasses it (audit 3.10 — same pattern fixed in governance.repo).
  const WRITABLE = new Set([...EDITABLE, "api_key_enc", "last_rotated_at", "last_rotated_by"]);
  const cols = Object.keys(fields).filter((k) => WRITABLE.has(k));
  if (cols.length === 0) {
    const { rows } = await platformDb.query(`SELECT ${SAFE} FROM ai_vendor_credential WHERE vendor = $1`, [vendor]);
    return decorate(rows[0] || null);
  }
  const insertCols = ["vendor", ...cols].join(", ");
  const insertVals = ["$1", ...cols.map((_, i) => `$${i + 2}`)].join(", ");
  const updateSet = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const params = [vendor, ...cols.map((c) => fields[c])];
  const { rows } = await platformDb.query(
    `INSERT INTO ai_vendor_credential (${insertCols}) VALUES (${insertVals})
     ON CONFLICT (vendor) DO UPDATE SET ${updateSet}, updated_at = now()
     RETURNING ${SAFE}`,
    params,
  );
  return decorate(rows[0]);
}

/**
 * INTERNAL — the vendor the platform has chosen to answer chat calls first, or
 * null when no row is flagged. Read by `llm.service.resolveChain` on every
 * call, uncached on purpose — the same trade `getConfig` makes, so a switch in
 * the console takes effect on the next turn on every API instance with no
 * restart and no window in which two instances disagree. One indexed
 * single-row read against a multi-second model call is not the cost to save.
 *
 * Active rows only: a vendor the operator has switched OFF is not a vendor
 * they want tried first, whatever the flag still says.
 */
async function getChatPrimary() {
  const { rows } = await platformDb.query(
    "SELECT vendor FROM ai_vendor_credential WHERE is_chat_primary AND is_active LIMIT 1",
  );
  return rows[0] ? rows[0].vendor : null;
}

/**
 * Make `vendor` the primary chat provider for the whole deployment.
 *
 * Refused for anything not in `CHAT_VENDORS` (Groq is voice, "embeddings" is
 * OpenAI's embedding endpoint — neither answers /chat/completions, and a
 * primary that always 404s means every turn pays a failed call before the
 * fallback answers). Refused for a vendor with no row: the row is where the
 * key and endpoint live, so "primary" without one is a promise nothing can
 * keep — save the vendor first.
 *
 * Two statements in ONE transaction rather than a single UPDATE with
 * `is_chat_primary = (vendor = $1)`: the partial unique index is checked
 * row-by-row inside a statement, so if the new primary's row is visited
 * before the old one is cleared the statement fails on the transient
 * duplicate. Clear, then set, atomically.
 *
 * Audited on `platform.platform_audit`: this changes which vendor every
 * tenant's AI is billed to from the next turn on, which is exactly the kind
 * of change someone will need to date later.
 */
async function setChatPrimary({ vendor, actorId = null }) {
  if (!CHAT_VENDORS.includes(vendor)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `"${vendor}" cannot be the primary chat provider — it does not answer chat calls. Choose one of: ${CHAT_VENDORS.join(", ")}.`,
      422,
    );
  }
  const cli = await platformDb.getPool().connect();
  try {
    await cli.query("BEGIN");
    const { rows: before } = await cli.query(
      "SELECT vendor FROM ai_vendor_credential WHERE is_chat_primary FOR UPDATE",
    );
    await cli.query("UPDATE ai_vendor_credential SET is_chat_primary = false, updated_at = now() WHERE is_chat_primary");
    const { rows } = await cli.query(
      `UPDATE ai_vendor_credential SET is_chat_primary = true, updated_at = now()
        WHERE vendor = $1
        RETURNING ${SAFE}`,
      [vendor],
    );
    if (!rows[0]) {
      await cli.query("ROLLBACK");
      throw new AppError("NOT_FOUND", `AI provider "${vendor}" is not configured — save its endpoint and key first.`, 404);
    }
    await cli.query(
      "INSERT INTO platform.platform_audit (actor_id, tenant_id, action, entity_ref, payload) VALUES ($1,NULL,$2,$3,$4)",
      [actorId || null, "ai_vendor.chat_primary_set", "ai_vendor:" + vendor, { vendor, previous: before[0] ? before[0].vendor : DEFAULT_PRIMARY }],
    );
    await cli.query("COMMIT");
    return decorate(rows[0]);
  } catch (err) {
    // A ROLLBACK after the explicit one above is a no-op; after a failed
    // statement it is the thing that releases the row locks.
    await cli.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cli.release();
  }
}

/** INTERNAL — decrypted config for the AI runtime. Never exposed over HTTP. */
async function getConfig(vendor) {
  const { rows } = await platformDb.query(
    "SELECT vendor, endpoint_url, default_model, current_model, api_key_enc, is_active FROM ai_vendor_credential WHERE vendor = $1",
    [vendor],
  );
  const full = rows[0];
  if (!full) return null;
  return {
    vendor: full.vendor,
    endpoint_url: full.endpoint_url,
    model: full.current_model || full.default_model,
    api_key: full.api_key_enc ? encryption.decrypt(full.api_key_enc) : null,
    is_active: full.is_active,
  };
}

/** Live auth check against the vendor's /models endpoint. No writes. */
async function test(vendor) {
  const cfg = await getConfig(vendor);
  if (!cfg || !cfg.api_key) return { ok: false, error: "no API key configured for " + vendor };
  if (!cfg.endpoint_url) return { ok: false, error: "no endpoint_url configured for " + vendor };
  try {
    const base = String(cfg.endpoint_url).replace(/\/$/, "");
    const res = await axios.get(base + "/models", { headers: { Authorization: "Bearer " + cfg.api_key }, timeout: 15000 });
    const count = res.data && Array.isArray(res.data.data) ? res.data.data.length : null;
    return { ok: true, vendor, models: count };
  } catch (err) {
    const r = err.response;
    return { ok: false, vendor, status: r && r.status, error: (r && r.data && ((r.data.error && r.data.error.message) || r.data.message)) || err.message };
  }
}

module.exports = { list, set, getConfig, getChatPrimary, setChatPrimary, test };
