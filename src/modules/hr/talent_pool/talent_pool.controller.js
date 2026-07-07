"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./talent_pool.service"), "Talent");
