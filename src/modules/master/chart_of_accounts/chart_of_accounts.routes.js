"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./chart_of_accounts.controller");
const validator = require("./chart_of_accounts.validator");
module.exports = { basePath: "/chart-of-accounts", feature: null, router: makeRouter({ controller, validator, softDeletable: false }) };
