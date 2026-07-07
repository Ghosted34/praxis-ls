/**
 * Embeddings — OpenAI-compatible endpoint (also serves DeepSeek/other). Returns
 * Float32-friendly number[] of length EMBEDDINGS_DIM. Batches inputs. The vector
 * is written to *_chunk.embedding (pgvector) via pgvector's toSql in the repo.
 */
"use strict";

const { groups, config } = require("../../config/env");

let client = null;
function openai() {
  if (!client) {
    // Lazy require so the app boots without the dep during non-AI ops.
    const OpenAI = require("openai");
    const e = groups.ai.embeddings;
    client = new OpenAI({ apiKey: e.openaiKey, baseURL: e.openaiBaseUrl });
  }
  return client;
}

/** Embed an array of strings → array of number[] (length EMBEDDINGS_DIM). */
async function embedBatch(texts) {
  if (!texts || texts.length === 0) return [];
  const res = await openai().embeddings.create({
    model: config.EMBEDDINGS_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

const embedOne = async (text) => (await embedBatch([text]))[0];

module.exports = { embedBatch, embedOne, dim: config.EMBEDDINGS_DIM };
