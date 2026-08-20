/**
 * Spreadsheet service — the ONE server-side spreadsheet toolkit (ExcelJS +
 * CSV) for templates, exports and imports. This index re-exports the same
 * public names the old single-file `spreadsheet.service.js` exposed
 * (buildWorkbook, parseWorkbook, buildCsv, parseCsv, parseUpload,
 * REFERENCE_SHEET) plus the brand/currency layer added with the split:
 * resolveContext/neutralContext, moneyColumns/convertToBase, exportFilename.
 *
 * The contract that matters, in one place:
 *   - PRODUCTION callers resolve a WorkbookContext inside their tenant
 *     connection (req.tenantDb / the job's withTenantConnection) and pass it
 *     to buildWorkbook/buildCsv. A missing context renders the neutral Praxis
 *     default — that affordance exists for unit tests, and shipping unbranded
 *     output because a caller skipped resolveContext is a bug.
 *   - The builder is PURE (no client, no query) so it unit-tests without a DB.
 *   - ExcelJS stays server-side; the client never gains a spreadsheet writer.
 *
 * Split from one file (spreadsheet.service.js) when the brand/currency/
 * packaging layers arrived — each piece is still require-able on its own.
 */
"use strict";

module.exports = {
  // build
  ...require("./build"),
  // csv
  ...require("./csv"),
  // parse
  parseWorkbook: require("./parse").parseWorkbook,
  parseUpload: require("./parse").parseUpload,
  // context (brand + currency resolution, once per request/job)
  ...require("./context"),
  // money (dual-column declaration + MOD-08 conversion)
  ...require("./money"),
  // pure primitives, shared with services/statements/xlsx.js
  ...require("./helpers"),
};
