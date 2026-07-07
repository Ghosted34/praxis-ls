"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./goods_received.controller");
const validator = require("./goods_received.validator");
module.exports = { basePath: "/goods-received", feature: "procurement", router: makeRouter({ controller, validator }) };
