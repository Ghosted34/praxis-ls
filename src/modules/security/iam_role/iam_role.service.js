"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./iam_role.repo");
const events = require("./iam_role.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "iam_role", events });
