"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./document_signature.repo");
const events = require("./document_signature.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "document_signature", events });
