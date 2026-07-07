"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./delivery_note.service"), "Delivery note");
