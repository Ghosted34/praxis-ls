"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./success_story.controller");
const validator = require("./success_story.validator");
module.exports = { basePath: "/portfolio", feature: "sales.crm", router: makeRouter({ controller, validator }) };
