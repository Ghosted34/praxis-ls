"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./final_invoice.controller");
const validator = require("./final_invoice.validator");
module.exports = { basePath: "/final-invoices", feature: null, router: makeRouter({ controller, validator }) };
