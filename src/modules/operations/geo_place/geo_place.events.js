"use strict";
/**
 * geo_place has no catalogue module of its own. It is reference data FOR the
 * dossier, and its only consumers are the dossier form's port pickers and the
 * Control Tower map — so it rides MOD-29 (operations file).
 *
 * This is deliberate, not laziness: `requirePermission` resolves grants BY
 * module_key, and a key absent from `platform.feature_catalogue` has no grants
 * for anyone, so every non-CEO user would be denied. Reusing MOD-29 gives the
 * coherent rule "if you can view dossiers, you can look up the ports they route
 * through". Give it its own key only if it ever gains a real admin surface.
 */
module.exports = {
  MODULE: "MOD-29",
  CREATED: "geo_place.created",
  UPDATED: "geo_place.updated",
};
