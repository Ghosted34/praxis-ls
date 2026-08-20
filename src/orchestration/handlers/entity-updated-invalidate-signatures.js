/**
 * entity.updated / entity.letterhead_updated → drop cached signature renders
 * for every user of that entity.
 *
 * The guide named this corporate_entity.updated. The catalogue key in this
 * codebase is entity.updated (see corporate_entity.events.js). Registering
 * against a key nothing emits would mean promotions of the COMPANY never
 * reached the cache.
 */
"use strict";

const signatures = require("../../modules/mail/signature/signature.service");

function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

async function run(client, event) {
  const entityId = idFromRef(event.entity_ref, "entity")
    || idFromRef(event.entity_ref, "corporate_entity");
  if (!entityId) return { skipped: "no entity ref" };
  return signatures.invalidateForEntity(client, entityId);
}

module.exports = {
  eventKey: "entity.updated",
  handlerKey: "entity.updated:invalidate-signatures",
  feature: null,
  run,
};
