"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./cycle_count.controller");
const validator = require("./cycle_count.validator");
module.exports = { basePath: "/cycle-counts", feature: "wms.cycle_count", router: makeRouter({ controller, validator }) };
