"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./goods_received.repo");
const events = require("./goods_received.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "goods_received", events });
