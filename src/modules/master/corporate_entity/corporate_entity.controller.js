"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./corporate_entity.service"), "Corporate entity");
