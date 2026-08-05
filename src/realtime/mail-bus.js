/**
 * Cross-process mail event bus. Inbound sync runs in the WORKER process, but the
 * socket.io server lives in the WEB process — so the worker can't emit to clients
 * directly. It publishes here (Redis pub/sub, dedicated publisher client); the web
 * process subscribes in realtime/index.js and re-emits `mail:new` to the tenant's
 * mail room. Best-effort: a Redis hiccup must never break the sync.
 */
"use strict";

const { getPublisher } = require("../config/redis");
const { logger } = require("../config/logger");

const CHANNEL = "mail:events";

function publishMailEvent(slug, payload) {
  if (!slug) return;
  try {
    getPublisher().publish(CHANNEL, JSON.stringify({ slug, payload: payload || {} }));
  } catch (err) {
    logger.debug({ err }, "[mail-bus] publish skipped (redis not ready)");
  }
}

module.exports = { publishMailEvent, CHANNEL };
