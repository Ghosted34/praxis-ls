"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "marketing_campaign", pk: "campaign_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
