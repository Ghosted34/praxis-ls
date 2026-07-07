"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./fleet_dispatch.controller");
const validator = require("./fleet_dispatch.validator");
module.exports = { basePath: "/dispatch", feature: "fleet", router: makeRouter({ controller, validator }) };
