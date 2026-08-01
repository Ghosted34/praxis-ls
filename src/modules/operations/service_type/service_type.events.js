"use strict";
/**
 * Service taxonomy (sea import, air import, hinterland transit…).
 *
 * MODULE KEY: rides **MOD-29** (operations file), like `geo_place`. Two reasons:
 * a module_key absent from `platform.feature_catalogue` has grants for nobody,
 * so a brand-new key would 403 every non-CEO user until the catalogue was
 * re-seeded; and the taxonomy is the dossier's own classification, so "you can
 * manage operation files, you can manage the service types they use" is a
 * coherent rule. Revisit if service-type administration ever needs to be
 * separable from day-to-day dossier work.
 */
module.exports = {
  MODULE: "MOD-29",
  CREATED: "service_type.created",
  UPDATED: "service_type.updated",
  ARCHIVED: "service_type.archived",
};
