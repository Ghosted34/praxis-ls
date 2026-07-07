"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./success_story.repo");
const events = require("./success_story.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "success_story", events });
