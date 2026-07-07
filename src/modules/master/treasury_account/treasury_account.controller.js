"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./treasury_account.service"), "Treasury account");
