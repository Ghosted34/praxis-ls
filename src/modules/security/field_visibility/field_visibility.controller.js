// ai:none — per-field visibility rules — the redaction boundary the assistant's own answers are filtered through.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Field-visibility rules are identity data (env-independent) — pin to live.
module.exports = makeController(require("./field_visibility.service"), "Field visibility rule", { identity: true });
