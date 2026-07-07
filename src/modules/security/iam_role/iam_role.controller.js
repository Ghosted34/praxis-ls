"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./iam_role.service"), "Role");
