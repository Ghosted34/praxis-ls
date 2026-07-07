"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./meeting.controller");
const validator = require("./meeting.validator");
module.exports = { basePath: "/meetings", feature: "sales.crm", router: makeRouter({ controller, validator }) };
