/**
 * Embeddings — OpenAI-compatible endpoint. DB-first: creds/endpoint/model from
 * governance.getVendorConfig(client, "embeddings"); falls back to .env
 * (OPENAI_API_KEY/OPENAI_BASE_URL/EMBEDDINGS_MODEL) per BUILD_CONVENTIONS §7. The
 * pgvector dimension is a schema constant. With no vendor configured at all we
 * return empty vectors and the chunk embedding stays NULL — retrieval finds no
 * vector hits.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const governance = require("../../modules/ai/governance/governance.service");
const { logger } = require("../../config/logger");

async function resolveVendor(client) {
  if (client) {
    const db = await governance.getVendorConfig(client, "embeddings");
    if (db && db.api_key && db.endpoint_url) return db;
  }
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
