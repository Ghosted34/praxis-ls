"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./incident.controller");
const validator = require("./incident.validator");
module.exports = { basePath: "/incidents", feature: "fleet", router: makeRouter({ controller, validator }) };
