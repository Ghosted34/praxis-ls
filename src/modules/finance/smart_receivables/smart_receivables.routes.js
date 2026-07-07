"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./smart_receivables.controller");
const validator = require("./smart_receivables.validator");
module.exports = { basePath: "/receivables", feature: null, router: makeRouter({ controller, validator }) };
