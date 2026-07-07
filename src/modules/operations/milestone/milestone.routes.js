"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./milestone.controller");
const validator = require("./milestone.validator");
module.exports = { basePath: "/milestones", feature: "operations", router: makeRouter({ controller, validator }) };
