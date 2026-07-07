"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "success_story", pk: "success_story_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
