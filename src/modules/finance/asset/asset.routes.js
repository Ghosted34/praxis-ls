"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./asset.controller");
const validator = require("./asset.validator");
module.exports = { basePath: "/assets", feature: null, router: makeRouter({ controller, validator }) };
