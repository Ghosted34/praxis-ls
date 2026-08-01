"use strict";
const { makeController } = require("../../../shared/crud/resource");
const service = require("./service_type.service");

// The kit gives list/get/create/update/archive with the right shapes; `list`
// passes req.query straight through, so ?q= and ?includeInactive= reach the repo.
module.exports = makeController(service, "Service type");
