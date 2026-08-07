"use strict";
const service = require("./corporate_entity.service");
const dossierService = require("../entity-360.service");
const validator = require("./corporate_entity.validator");

/**
 * AI surface for MOD-01.
 *
 * The reads are what let the assistant answer the questions this module exists
 * to make answerable — "who are the directors of SLAS", "which entities do we
 * have in France", "does our France entity's cap table balance". `get_entity_360`
 * is one call rather than five because the assistant should not have to know the
 * child-collection layout to describe an entity.
 *
 * `get_entity_360` here is the RAW aggregation: unlike the HTTP route it has no
 * `req` to resolve governance from, so it is registered with an edit permission
 * and returns the unredacted dossier. The permission is the gate.
 */
module.exports = {
  entity: "corporate_entity", module_key: "MOD-01", screens: [],
  reads: [
    { key: "list_entities", service: service.list, describe: "List corporate entities (filter: q, country_code, registration_status, is_active)." },
    { key: "get_entity", service: service.get, describe: "Get a corporate entity by id." },
    {
      key: "get_entity_360",
      service: (c, p) => dossierService.dossier(c, p.entity_id || p, { governance: true }),
      describe: "Full dossier for one entity: identity, group structure, people and shareholding, contacts, addresses, registrations, establishments, treasury accounts (read-only) and the readiness checklist.",
    },
    {
      key: "get_entity_cap_table",
      service: (c, p) => service.capTable(c, p.entity_id || p, (p && p.as_of) || null),
      describe: "Shareholding reconciliation for one entity: holders, totals and any mismatch findings, optionally as of a past date.",
    },
    {
      key: "get_entity_renewals",
      service: (c, p) => service.renewals(c, p.entity_id || p, (p && p.as_of) || null),
      describe: "Documents, registrations and tax registrations on one entity that have expired or are approaching expiry, most urgent first. Answers 'when does our France VAT certificate expire' and 'what is lapsing this quarter'.",
    },
    {
      key: "get_entity_letterhead",
      service: (c, p) => service.letterhead(c, p.entity_id || p, (p && p.lang) || null),
      describe: "The letterhead/footer configuration for one entity and the rendered header, footer and payment block in both languages.",
    },
  ],
  writes: [
    { key: "create_entity", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-01", action: "create" }, confirm: true, describe: "Register a corporate entity (unique code, NIU/RCCM, fiscal year, accounting framework)." },
    { key: "update_entity", service: (c, p) => (({ entity_id, ...patch }) => service.update(c, { id: entity_id, patch }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-01", action: "edit" }, confirm: true, describe: "Edit a corporate entity by id." },
    { key: "set_entity_status", service: (c, p) => service.setStatus(c, { id: p.entity_id, status: p.status, reason: p.reason || null }), schema: validator.schemas.aiSetStatus, permission: { module: "MOD-01", action: "edit" }, confirm: true, describe: "Move an entity along its lifecycle (DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, DEACTIVATED, ARCHIVED). A reason is required for the last three." },
    { key: "set_entity_active", service: (c, p) => service.setActive(c, { id: p.entity_id, active: p.active }), schema: validator.schemas.aiSetActive, permission: { module: "MOD-01", action: "edit" }, confirm: true, describe: "Activate/deactivate an entity by id." },
  ],
};
