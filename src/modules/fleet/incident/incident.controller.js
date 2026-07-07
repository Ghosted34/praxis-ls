"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./incident.service"), "Incident");
