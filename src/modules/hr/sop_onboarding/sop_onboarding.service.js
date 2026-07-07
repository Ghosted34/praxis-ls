"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./sop_onboarding.repo");
const events = require("./sop_onboarding.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "sop_onboarding", events });
