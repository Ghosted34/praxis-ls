"use strict";
/**
 * @praxis/shared — the single definition of "valid" for payloads that cross
 * the API/client boundary. See README.md in this directory for why it is
 * CommonJS, why Zod is a peer dependency, and how to add a schema.
 */
const common = require("./schemas/common");
const finalInvoice = require("./schemas/final-invoice");

module.exports = { common, finalInvoice };
