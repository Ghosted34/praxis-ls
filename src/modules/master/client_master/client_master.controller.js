"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./client_master.service"), "Client");
