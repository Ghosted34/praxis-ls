/**
 * Embeddings — OpenAI-compatible endpoint. Vendor creds/endpoint/model come from
 * the DB (governance.getVendorConfig(client, "embeddings")), NOT .env
 * (doc/BUILD_CONVENTIONS.md §7). The pgvector dimension is a schema constant so
 * it stays in config. With no embeddings vendor (or no tenant client, e.g. a
 * global reindex) we return empty vectors and the chunk embedding stays NULL —
 * retrieval simply finds no vector hits.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../config/env");
const governance = require("../../modules/ai/governance/governance.service");
const { logger } = require("../../config/logger");

async function embedBatch(client, texts) {
  if (!texts || texts.length === 0) return [];
  if (!client) return [];
  const vendor = await governance.getVendorConfig(client, "embeddings");
  if (!vendor || !vendor.api_key || !vendor.endpoint_url) return [];
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
