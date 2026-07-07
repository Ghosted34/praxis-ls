"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./sop_onboarding.controller");
const validator = require("./sop_onboarding.validator");
module.exports = { basePath: "/sops", feature: null, router: makeRouter({ controller, validator }) };
