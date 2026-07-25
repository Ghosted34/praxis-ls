/**
 * Orchestration handler registry (Plan A / A1). Handlers subscribe to a domain
 * event key (the same `event_type_key` written to event_log by emitEvent); the
 * dispatcher invokes them for each committed event. This mirrors the `*.ai.js`
 * manifest convention — a module ships an orchestration handler, registers it in
 * src/orchestration/handlers/index.js, and it joins the flow.
 *
 * Handler shape: { eventKey, handlerKey, feature?, run(client, event) }
 *   - eventKey   : event_type_key to subscribe to (e.g. "opportunity.won")
 *   - handlerKey : stable unique id (for logs / dedupe of re-require)
 *   - feature    : optional feature_state key; handler is skipped when off
 *   - run        : async (client, event) — MUST be idempotent (A2), since
 *                  delivery is at-least-once. `event` = { event_id,
 *                  event_type_key, entity_ref, payload, attempts }.
 */
"use strict";

const handlers = new Map();

function register(h) {
  if (!h || !h.eventKey || !h.handlerKey || typeof h.run !== "function") {
    throw new Error("orchestration.register: handler needs { eventKey, handlerKey, run }");
  }
  const list = handlers.get(h.eventKey) || [];
  if (list.some((x) => x.handlerKey === h.handlerKey)) return; // idempotent re-require
  list.push(h);
  handlers.set(h.eventKey, list);
}

const getHandlers = (eventKey) => handlers.get(eventKey) || [];
const eventKeys = () => [...handlers.keys()];

module.exports = { register, getHandlers, eventKeys };
