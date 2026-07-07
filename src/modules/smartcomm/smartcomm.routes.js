"use strict";
const { makeRouter } = require("../../shared/crud/resource");
const controller = require("./smartcomm.controller");
const validator = require("./smartcomm.validator");
module.exports = { basePath: "/smartcomm", feature: "comms", router: makeRouter({ controller, validator }) };
