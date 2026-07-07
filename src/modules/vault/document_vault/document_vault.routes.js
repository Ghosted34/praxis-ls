"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./document_vault.controller");
const validator = require("./document_vault.validator");
module.exports = { basePath: "/documents", feature: null, router: makeRouter({ controller, validator }) };
