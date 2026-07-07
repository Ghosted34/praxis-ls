"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./sop_onboarding.service"), "SOP");
