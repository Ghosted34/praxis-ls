"use strict";
/**
 * Shipment-detail field sets — the form a service type asks for.
 *
 * MODULE KEY: rides **MOD-29**, like `service_type` and `geo_place`, and for the
 * same reason spelled out there: a module_key absent from
 * `platform.feature_catalogue` has grants for nobody, and "you can manage
 * operation files, you can manage the details they capture" is a coherent rule.
 *
 * Publishing is audited separately from editing a draft. Editing a draft
 * changes nothing anybody sees; publishing changes the form every new file of
 * that service type will be created against, which is the event worth finding
 * in an audit trail six months later.
 */
module.exports = {
  MODULE: "MOD-29",
  SET_CREATED: "service_type_field_set.created",
  SET_PUBLISHED: "service_type_field_set.published",
  SET_UPDATED: "service_type_field_set.updated",
  FIELD_ADDED: "service_type_field.added",
  FIELD_UPDATED: "service_type_field.updated",
  FIELD_REMOVED: "service_type_field.removed",
  CONTAINERS_CONFIGURED: "service_type.containers_configured",
};
