"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./supplier_invoice.controller");
const validator = require("./supplier_invoice.validator");
module.exports = { basePath: "/supplier-invoices", feature: "procurement", router: makeRouter({ controller, validator }) };
