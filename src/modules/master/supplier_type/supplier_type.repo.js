/** Supplier-category registry (MOD-04). Built from the shared registry kit. */
"use strict";
const { build } = require("../_shared/registry");
// The `writable` allow-list closes mass-assignment (a request cannot set
// is_system) and is what the write-route CI gate keys on for this module.
module.exports = build({
  table: "supplier_type",
  pk: "supplier_type_id",
  moduleKey: "MOD-04",
  label: "supplier_type",
  writable: ["code", "name", "is_active"],
});
