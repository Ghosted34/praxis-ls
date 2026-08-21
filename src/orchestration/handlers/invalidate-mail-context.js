/**
 * The four events that make a cached dossier drawer wrong (§7.5).
 *
 *   invoice.posted · payment.received · milestone.completed · document.captured
 *
 * Registered once per event key. Without these the 60-second TTL is the only
 * thing correcting the drawer, which means an operator who posts a payment and
 * flips back to the thread sees the old balance for up to a minute — on the
 * screen whose entire purpose is to be right about the balance.
 *
 * Idempotent, per `src/orchestration/registry.js`: at-least-once delivery, and
 * invalidating an already-empty key is a successful no-op.
 */
"use strict";

const cache = require("../../modules/mail/binding/context-cache");

/**
 * The entity whose drawer this event changes.
 *
 * An event names its own record (`invoice:<id>`), but the drawer is keyed on
 * the PARTY, so the payload's client/supplier reference is what matters. Events
 * that carry neither are skipped rather than guessed at — invalidating the
 * wrong key is silent, and invalidating everything is a stampede.
 */
function entityRefsFor(event) {
  const p = event.payload || {};
  const out = new Set();
  for (const key of ["entity_ref", "client_ref", "party_ref"]) {
    if (typeof p[key] === "string" && p[key].includes(":")) out.add(p[key]);
  }
  if (p.client_id) out.add(`client:${p.client_id}`);
  if (p.supplier_id) out.add(`supplier:${p.supplier_id}`);
  if (p.dossier_id) out.add(`dossier:${p.dossier_id}`);
  // The event's own subject, for a drawer opened directly on that record.
  if (typeof event.entity_ref === "string" && event.entity_ref.includes(":")) out.add(event.entity_ref);
  return [...out];
}

const handlerFor = (eventKey) => ({
  eventKey,
  handlerKey: `${eventKey}:invalidate-mail-context`,
  feature: null,
  async run(_client, event) {
    const refs = entityRefsFor(event);
    if (!refs.length) return { skipped: "no party reference on the event" };
    let removed = 0;
    for (const ref of refs) {
      // eslint-disable-next-line no-await-in-loop
      removed += await cache.invalidate(ref);
    }
    return { invalidated: refs, keys: removed };
  },
});

module.exports = {
  handlerFor,
  entityRefsFor,
  handlers: cache.INVALIDATING_EVENTS.map(handlerFor),
};
