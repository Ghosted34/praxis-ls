"use strict";
const { makeRouter } = require("../../../shared/crud/resource");
const controller = require("./marketing_campaign.controller");
const validator = require("./marketing_campaign.validator");
module.exports = { basePath: "/campaigns", feature: "sales.marketing", router: makeRouter({ controller, validator }) };
