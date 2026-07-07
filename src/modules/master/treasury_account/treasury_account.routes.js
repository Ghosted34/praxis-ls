"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./treasury_account.controller");
const validator = require("./treasury_account.validator");
module.exports = { basePath: "/treasury-accounts", feature: null, router: makeRouter({ controller, validator }) };
