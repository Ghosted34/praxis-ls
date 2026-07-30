/**
 * Embeddings — OpenAI-compatible endpoint. Platform-first: creds/endpoint/model
 * from the shared platform.ai_vendor_credential "embeddings" row; falls back to .env
 * (OPENAI_API_KEY/OPENAI_BASE_URL/EMBEDDINGS_MODEL) per BUILD_CONVENTIONS §7. The
 * pgvector dimension is a schema constant. With no vendor configured at all we
 * return empty vectors and the chunk embedding stays NULL — retrieval finds no
 * vector hits.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const platformVendors = require("../platform/ai-vendor.service");
const { logger } = require("../../config/logger");

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
      { model: vendor.model || config.EMBEDDINGS_MODEL, input: texts },
      { headers: { Authorization: `Bearer ${vendor.api_key}`, "Content-Type": "application/json" }, timeout: 60000 },
    );
    return (data.data || []).map((d) => d.embedding);
  } catch (err) {
    logger.warn({ err: err.message }, "embeddings call failed -> skipping vectors");
    return [];
  }
}

const embedOne = async (client, text) => (await embedBatch(client, [text]))[0];

module.exports = { embedBatch, embedOne, dim: config.EMBEDDINGS_DIM };
