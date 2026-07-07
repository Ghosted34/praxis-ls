"use strict";
const { makeController } = require("../../../shared/crud/resource");
const service = require("./employees.service");
module.exports = makeController(service, "Employee");
