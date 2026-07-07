"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./leave_allowance.service"), "Leave request");
