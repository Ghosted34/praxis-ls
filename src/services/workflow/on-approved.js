/**
 * Approval → action dispatcher (doc/BUILD_CONVENTIONS.md §2/§5).
 *
 * Connects a cleared approval chain back to the module that owns the record, so
 * "what should connect isn't scattered". A module registers a handler for its
 * entity_ref prefix (e.g. "invoice"); when the workflow executor completes a
 * chain as APPROVED, `dispatch` calls that handler on the same tenant client
 * (inside the acting transaction) to post/finalise the record.
 *
 * entity_ref convention: "<prefix>:<id>" (e.g. "invoice:<uuid>").
 */
"use strict";

const handlers = new Map();
const rejectHandlers = new Map();

/** Register `fn(client, { id, entityRef, actor })` for an entity_ref prefix. */
function register(prefix, fn) {
  handlers.set(prefix, fn);
}

/** Register the REJECT counterpart — called when a chain completes as rejected,
 *  so the module can move its record to a terminal rejected state. Optional. */
function registerReject(prefix, fn) {
  rejectHandlers.set(prefix, fn);
}

function handlerFor(entityRef) {
  const prefix = String(entityRef).split(":")[0];
  return handlers.get(prefix) || null;
}

/** Invoke the owning module's post handler for an approved entity_ref. No-op if none. */
async function dispatch(client, entityRef, actor = {}) {
  const fn = handlerFor(entityRef);
  if (!fn) return { dispatched: false, reason: "no_handler" };
  const id = String(entityRef).split(":")[1];
  const result = await fn(client, { id, entityRef, actor });
  return { dispatched: true, result };
}

/** Invoke the owning module's reject handler for a rejected entity_ref. No-op if none. */
async function dispatchReject(client, entityRef, actor = {}) {
  const fn = rejectHandlers.get(String(entityRef).split(":")[0]);
  if (!fn) return { dispatched: false, reason: "no_handler" };
  const id = String(entityRef).split(":")[1];
  const result = await fn(client, { id, entityRef, actor });
  return { dispatched: true, result };
}

module.exports = { register, registerReject, dispatch, dispatchReject, handlerFor, _handlers: handlers };
