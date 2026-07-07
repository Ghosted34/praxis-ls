"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./compliance_flag.controller");
const validator = require("./compliance_flag.validator");
module.exports = { basePath: "/compliance-flags", feature: null, router: makeRouter({ controller, validator }) };
