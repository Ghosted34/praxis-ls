"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./journal_entry.controller");
const validator = require("./journal_entry.validator");
module.exports = { basePath: "/journal-entries", feature: "accounting.core", router: makeRouter({ controller, validator }) };
