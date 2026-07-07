"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./journal_entry.service"), "Journal entry");
