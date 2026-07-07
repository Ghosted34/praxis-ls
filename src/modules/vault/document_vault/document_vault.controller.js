"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./document_vault.service"), "Document");
