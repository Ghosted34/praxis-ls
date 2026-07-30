/**
 * Platform (deploy-wide) AI vendor credentials — ONE shared key set for every
 * tenant. Managed only from the platform console; the AI runtime reads decrypted
 * keys via getConfig(). Keys are AES-256-GCM encrypted at rest; HTTP reads never
 * expose the key, only its presence.
 */
"use strict";

const axios = require("axios");
const platformDb = require("./db");
const encryption = require("../encryption.service");

// Never selects api_key_enc — callers over HTTP only learn whether a key is set.
const SAFE = "vendor, display_name, endpoint_url, default_model, current_model, is_active, (api_key_enc IS NOT NULL) AS has_key, last_rotated_at";
const EDITABLE = ["display_name", "endpoint_url", "default_model", "current_model", "is_active"];

async function list() {
  const { rows } = await platformDb.query(`SELECT ${SAFE} FROM ai_vendor_credential ORDER BY vendor`);
  return rows;
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
  const cols = Object.keys(fields);
  if (cols.length === 0) {
    const { rows } = await platformDb.query(`SELECT ${SAFE} FROM ai_vendor_credential WHERE vendor = $1`, [vendor]);
    return rows[0] || null;
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
  return rows[0];
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

module.exports = { list, set, getConfig, test };
