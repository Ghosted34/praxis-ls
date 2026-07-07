"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./supplier_master.controller");
const validator = require("./supplier_master.validator");
module.exports = { basePath: "/suppliers", feature: null, router: makeRouter({ controller, validator }) };
