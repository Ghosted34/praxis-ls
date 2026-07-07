"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./notification.controller");
const validator = require("./notification.validator");
module.exports = { basePath: "/notifications", feature: null, router: makeRouter({ controller, validator }) };
