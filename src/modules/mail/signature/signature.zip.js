/**
 * The ZIP writer moved to `src/shared/files/zip.js` when the client portal
 * needed it too; this path stays so the signature module and its test keep
 * their import.
 */
"use strict";
module.exports = require("../../../shared/files/zip");
