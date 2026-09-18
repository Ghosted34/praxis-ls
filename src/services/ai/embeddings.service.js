/**
 * Embeddings — OpenAI-compatible endpoint. Platform-first: creds/endpoint/model
 * from the shared platform.ai_vendor_credential "embeddings" row; falls back to .env
 * (OPENAI_API_KEY/OPENAI_BASE_URL/EMBEDDINGS_MODEL) per BUILD_CONVENTIONS §7. The
 * pgvector dimension is a schema constant. With no vendor configured at all we
 * return empty vectors and the chunk embedding stays NULL — retrieval finds no
 * vector hits.
 *
 * ── EVERY TEXT IS STRICT-REDACTED HERE (audit A1) ───────────────────────────
 *
 * This is the one choke point the embeddings vendor is reached through, so the
 * scrub lives here rather than at each caller. It covers BOTH sides on purpose:
 * `ingest.service` embeds the corpus through `embedBatch` and `retrieval`
 * embeds the query through `embedOne`, so corpus and query are masked
 * identically and a query still matches what was indexed. Masking only one side
 * would have been a privacy gain of nothing and a recall loss of a great deal.
 *
 * `redactExternal` is the right class here: the vendor sees every chunk of the
 * tenant's corpus, and a vector derived from it is stored. Amounts and ERP
 * references survive the scrub, so "receivables over 100,000,000" still embeds
 * as the question the user asked.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const platformVendors = require("../platform/ai-vendor.service");
const { logger } = require("../../config/logger");
const { redactExternal } = require("./redact");

async function resolveVendor(_client) {
  // Shared deploy-wide key (platform.ai_vendor_credential), env fallback.
  const db = await platformVendors.getConfig("embeddings");
  if (db && db.is_active !== false && db.api_key && db.endpoint_url) return db;
  if (config.OPENAI_API_KEY && config.OPENAI_BASE_URL) {
    return { api_key: config.OPENAI_API_KEY, endpoint_url: config.OPENAI_BASE_URL, model: config.EMBEDDINGS_MODEL };
  }
  return null;
}

async function embedBatch(client, texts) {
  if (!texts || texts.length === 0) return [];
  const vendor = await resolveVendor(client);
  if (!vendor) return [];
  try {
    const base = String(vendor.endpoint_url).replace(/\/$/, "");
    const { data } = await axios.post(
      `${base}/embeddings`,
      { model: vendor.model || config.EMBEDDINGS_MODEL, input: texts.map(redactExternal) },
      { headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" }, timeout: 60000 },
    );
    return (data.data || []).map((d) => d.embedding);
  } catch (err) {
    logger.warn({ err }, "embeddings call failed -> skipping vectors");
    return [];
  }
}

const embedOne = async (client, text) => (await embedBatch(client, [text]))[0];

module.exports = { embedBatch, embedOne, dim: config.EMBEDDINGS_DIM };
