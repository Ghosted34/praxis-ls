"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./talent_pool.controller");
const validator = require("./talent_pool.validator");
module.exports = { basePath: "/talent-pool", feature: null, router: makeRouter({ controller, validator }) };
