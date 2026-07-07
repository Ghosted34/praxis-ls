"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./quotation.controller");
const validator = require("./quotation.validator");
module.exports = { basePath: "/quotations", feature: "commercial.quotation", router: makeRouter({ controller, validator }) };
