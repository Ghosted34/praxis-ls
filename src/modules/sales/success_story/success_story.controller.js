"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./success_story.service"), "Success story");
