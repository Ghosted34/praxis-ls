"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./client_master.controller");
const validator = require("./client_master.validator");
module.exports = { basePath: "/clients", feature: null, router: makeRouter({ controller, validator }) };
