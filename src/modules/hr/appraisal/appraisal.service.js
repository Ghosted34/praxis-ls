"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./appraisal.repo");
const events = require("./appraisal.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "appraisal", events });
