"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./costing.controller");
const validator = require("./costing.validator");
module.exports = { basePath: "/costings", feature: "costing", router: makeRouter({ controller, validator }) };
