"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./document_signature.controller");
const validator = require("./document_signature.validator");
module.exports = { basePath: "/signatures", feature: "signatures", router: makeRouter({ controller, validator }) };
