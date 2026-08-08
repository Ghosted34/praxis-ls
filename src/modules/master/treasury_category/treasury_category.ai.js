"use strict";
const service = require("./treasury_category.service");
const validator = require("./treasury_category.validator");
module.exports = {
  entity: "treasury_category", module_key: "MOD-09", screens: [],
  reads: [
    { key: "list_treasury_categories", service: service.list, describe: "List treasury categories (Bank, Cash, Petty Cash, MTN MoMo, etc.)." },
  ],
  writes: [
    {
      key: "create_treasury_category",
      service: (c, p) => service.create(c, {
        code: p.code, label: p.label, legacyKind: p.legacy_kind, coaParentCode: p.coa_parent_code,
        requiresCustodian: p.requires_custodian, isBankIdentity: p.is_bank_identity, isMomoIdentity: p.is_momo_identity,
      }),
      schema: validator.schemas.create,
      permission: { module: "MOD-09", action: "create" },
      confirm: true,
      describe: "Add a new treasury category (account type) mapped to a class-5 CoA parent.",
    },
  ],
};
