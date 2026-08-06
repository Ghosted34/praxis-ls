/** Client-category registry (MOD-03). Built from the shared registry kit. */
"use strict";
const { build } = require("../_shared/registry");
// The `writable` allow-list closes mass-assignment (a request cannot set
// is_system to mint a system category) and is what the write-route CI gate keys
// on for this module.
module.exports = build({
  table: "client_type",
  pk: "client_type_id",
  moduleKey: "MOD-03",
  label: "client_type",
  writable: ["code", "name", "is_active"],
});
