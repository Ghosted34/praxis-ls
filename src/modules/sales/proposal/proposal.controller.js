"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./proposal.service"), "Proposal");
