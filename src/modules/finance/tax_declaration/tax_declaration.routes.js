"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./tax_declaration.controller");
const validator = require("./tax_declaration.validator");
module.exports = { basePath: "/tax-declarations", feature: "accounting.tax", router: makeRouter({ controller, validator }) };
