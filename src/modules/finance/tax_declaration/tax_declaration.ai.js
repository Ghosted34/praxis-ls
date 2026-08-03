"use strict";
const service = require("./tax_declaration.service");
module.exports = {
  entity: "tax_declaration",
  module_key: "MOD-07",
  screens: [],
  reads: [
    { key: "get_vat_return", service: service.vatReturn, describe: "TVA return over the GL: output − input VAT, net due/credit. KB §16." },
    { key: "get_corporate_tax", service: service.corporateTax, describe: "IS vs minimum tax (2.2% of turnover, débours excluded); greater is due. KB §15." },
  ],
  writes: [],
};
