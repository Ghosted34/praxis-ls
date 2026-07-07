"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./marketing_campaign.service"), "Campaign");
