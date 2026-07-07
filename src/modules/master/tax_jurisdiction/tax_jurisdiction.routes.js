"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./tax_jurisdiction.controller");
const validator = require("./tax_jurisdiction.validator");
module.exports = { basePath: "/tax-jurisdictions", feature: null, router: makeRouter({ controller, validator }) };
