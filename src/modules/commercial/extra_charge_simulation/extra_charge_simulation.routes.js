"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./extra_charge_simulation.controller");
const validator = require("./extra_charge_simulation.validator");
module.exports = { basePath: "/demurrage", feature: "commercial.simulators", router: makeRouter({ controller, validator }) };
