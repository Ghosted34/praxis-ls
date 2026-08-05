"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "field_visibility", pk: "field_visibility_id", activeColumn: null, searchColumn: "field_key", orderBy: "field_key ASC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "field_key"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});
