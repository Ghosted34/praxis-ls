"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./margin_simulation.controller");
const validator = require("./margin_simulation.validator");
module.exports = { basePath: "/margin-simulator", feature: "commercial.simulators", router: makeRouter({ controller, validator }) };
