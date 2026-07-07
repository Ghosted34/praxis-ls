"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./iam_role.controller");
const validator = require("./iam_role.validator");
module.exports = { basePath: "/roles", feature: null, router: makeRouter({ controller, validator }) };
