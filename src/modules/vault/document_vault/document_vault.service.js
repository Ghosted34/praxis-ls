"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./document_vault.repo");
const events = require("./document_vault.events");
module.exports = makeService({ repo, moduleKey: events.MODULE, entity: "document_vault", events });
