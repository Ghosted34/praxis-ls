"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./delivery_note.controller");
const validator = require("./delivery_note.validator");
module.exports = { basePath: "/delivery-notes", feature: "operations", router: makeRouter({ controller, validator }) };
