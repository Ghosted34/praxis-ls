"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./session.controller");
const validator = require("./session.validator");
module.exports = { basePath: "/sessions", feature: null, router: makeRouter({ controller, validator }) };
