/** KYC / compliance document-type registry (MOD-03). Shared registry kit. */
"use strict";
const { build } = require("../_shared/registry");
// The `writable` allow-list closes mass-assignment (a request cannot set
// is_system) and is what the write-route CI gate keys on for this module.
module.exports = build({
  table: "party_document_type",
  pk: "document_type_id",
  moduleKey: "MOD-03",
  label: "party_document_type",
  writable: ["code", "name", "applies_to", "requires_expiry", "requires_issuing_authority", "default_severity", "is_active"],
});
