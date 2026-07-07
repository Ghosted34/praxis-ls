"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
module.exports = makeRepo({ table: "contact_enquiry", pk: "contact_enquiry_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC" });
