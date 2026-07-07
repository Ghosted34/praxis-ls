"use strict";
const { makeController } = require("../../shared/crud/resource");
module.exports = makeController(require("./smartcomm.service"), "Comms group");
