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
const supplierMaster = require("./schemas/supplier-master");
const partyCommon = require("./schemas/party-common");
const partyConfig = require("./schemas/party-config");
const ledger = require("./rules/ledger");
const pwaDesign = require("./pwa-design");
const countries = require("./data/countries");

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
exports.supplierMaster = supplierMaster;
// Nested master-data resources shared by both masters (contacts, addresses,
// banks, documents, registrations, beneficial owners).
exports.partyCommon = partyCommon;
// Per-tenant field-requirement policy applied on top of the shape schemas.
exports.partyConfig = partyConfig;
// Canonical ISO country reference (code, name, phone, currency, per-jurisdiction
// registration requirements) — the API, the seed and the client picker's source.
exports.countries = countries;
// Domain INVARIANTS, not shape. See rules/ledger.js for why they are not a
// Zod refinement.
exports.ledger = ledger;
// Not a Zod schema — the shared *resolution* of the installed-app design (see
// pwa-design.js). It crosses the same boundary for the same reason: the API
// renders the home-screen PNG from it and the client renders the preview.
exports.pwaDesign = pwaDesign;
