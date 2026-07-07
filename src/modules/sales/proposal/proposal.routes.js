"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./proposal.controller");
const validator = require("./proposal.validator");
module.exports = { basePath: "/proposals", feature: "sales.proposals", router: makeRouter({ controller, validator }) };
