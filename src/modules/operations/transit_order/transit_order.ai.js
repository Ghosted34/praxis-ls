"use strict";
const service = require("./transit_order.service");
const validator = require("./transit_order.validator");

/**
 * MOD-30 tool catalogue for the function-calling assistant.
 *
 * ISSUE AND LODGE ARE EXPOSED; SIGN AND CANCEL ARE NOT — deliberately.
 *
 * `sign` asserts that a client physically stamped a piece of paper, on the
 * strength of a scan the assistant cannot see. `cancel` withdraws a numbered
 * customs instrument. Neither is a statement a language model should be able to
 * make on a user's behalf, however well it confirms first. Both stay
 * human-only, at the UI.
 *
 * Everything exposed is `confirm: true` and permission-gated on the same action
 * the HTTP route requires, so the gate cannot drift between the two surfaces.
 */
module.exports = {
  entity: "transit_order",
  module_key: "MOD-30",
  screens: [],
  reads: [
    { key: "list_transit_orders", service: service.list, describe: "List transit orders. Filter by dossier_id, entity_id, status (DRAFT|ISSUED|SIGNED|LODGED|CANCELLED), customs_regime, or q (searches OT number, file reference and declaration reference)." },
    { key: "get_transit_order", service: service.get, describe: "Get one transit order by id, with its cargo lines, value reconciliation and shipment details." },
    { key: "transit_order_summary", service: service.summary, describe: "Count transit orders by lifecycle state." },
  ],
  writes: [
    {
      key: "create_transit_order",
      service: (c, p) => service.create(c, {
        entityId: p.entity_id, dossierId: p.dossier_id,
        customsRegime: p.customs_regime, customsRegimeOther: p.customs_regime_other,
        serviceDirection: p.service_direction, declaredValue: p.declared_value,
        declaredCurrency: p.declared_currency, declaredFxToXaf: p.declared_fx_to_xaf,
        insuranceType: p.insurance_type, surveyorParty: p.surveyor_party,
        departureDate: p.departure_date, instructions: p.instructions,
        submittedDocs: p.submitted_docs, lines: p.lines,
        allowDuplicate: p.allow_duplicate === true,
      }),
      schema: validator.schemas.aiCreate,
      permission: { module: "MOD-30", action: "create" },
      confirm: true,
      describe: "Draft a transit order on an operations file. Creates a DRAFT — no number is allocated and nothing is sent until it is issued.",
    },
    {
      key: "update_transit_order_docs",
      service: (c, p) => service.updateDocs(c, { transitOrderId: p.transit_order_id, submittedDocs: p.submitted_docs }),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-30", action: "edit" },
      confirm: true,
      describe: "Set the attached-documents checklist on a transit order (INVOICE, PACKING_LIST, BL_AWB, EXONERATION, CERTIFICATE_OF_ORIGIN, PHYTOSANITARY, INSURANCE_CERTIFICATE, OTHER).",
    },
    {
      key: "issue_transit_order",
      service: (c, p) => service.issue(c, { id: p.transit_order_id, date: p.date }),
      schema: validator.schemas.aiIssue,
      permission: { module: "MOD-30", action: "create" },
      confirm: true,
      describe: "Issue a drafted transit order: allocates its OT number, freezes the shipment details onto it, and readies it for the client's signature.",
    },
    {
      key: "lodge_transit_order",
      service: (c, p) => service.lodge(c, { id: p.transit_order_id, declarationRef: p.declaration_ref }),
      schema: validator.schemas.aiLodge,
      permission: { module: "MOD-30", action: "edit" },
      confirm: true,
      describe: "Record that the customs declaration has been lodged against a SIGNED transit order, with its declaration reference. Refused if no client-signed copy is attached.",
    },
  ],
};
