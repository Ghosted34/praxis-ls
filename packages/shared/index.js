"use strict";
/**
 * @praxis/shared — the single definition of "valid" for payloads that cross
 * the API/client boundary. See README.md in this directory for why it is
 * CommonJS, why Zod is a peer dependency, and how to add a schema.
 */
const common = require("./schemas/common");
const finalInvoice = require("./schemas/final-invoice");
const journalEntry = require("./schemas/journal-entry");
const clientMaster = require("./schemas/client-master");
const ledger = require("./rules/ledger");

// Named `exports.x =` assignments, NOT `module.exports = { x }`.
//
// Both are identical to Node, so the API is unaffected — but the client is
// BUNDLED, and cjs-module-lexer (which esbuild and Rollup both use to discover
// a CommonJS module's named exports) cannot see through the object-literal
// form. With `module.exports = { … }` the bundlers found no named exports at
// all: `vite build` failed with `"finalInvoice" is not exported by
// packages/shared/index.js`, and in dev the import silently resolved to
// `undefined` — a form arrived at with no validation and a blank screen when
// zodResolver was handed it. See client/config/shared-alias.ts.
exports.common = common;
exports.finalInvoice = finalInvoice;
exports.journalEntry = journalEntry;
exports.clientMaster = clientMaster;
// Domain INVARIANTS, not shape. See rules/ledger.js for why they are not a
// Zod refinement.
exports.ledger = ledger;
