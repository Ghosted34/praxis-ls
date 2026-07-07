"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./proforma.controller");
const validator = require("./proforma.validator");
module.exports = { basePath: "/proformas", feature: null, router: makeRouter({ controller, validator }) };
