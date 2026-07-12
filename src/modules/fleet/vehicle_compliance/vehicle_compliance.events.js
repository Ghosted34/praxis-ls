"use strict";
// Renewal-alert event keys per compliance kind (seeded in 9020_seed_rbac_events).
const ALERT_EVENT = {
  insurance: "vehicle.insurance.expiring",
  visite_technique: "vehicle.visite_technique.expiring",
};

module.exports = {
  MODULE: "MOD-40",
  CREATED: "vehicle_compliance.created",
  UPDATED: "vehicle_compliance.updated",
  ARCHIVED: "vehicle_compliance.archived",
  ALERT_EVENT,
  /** Map a compliance kind to its renewal-alert event key. */
  eventFor: (kind) => ALERT_EVENT[kind] || null,
};
