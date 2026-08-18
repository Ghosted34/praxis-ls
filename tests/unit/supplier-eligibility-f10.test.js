"use strict";

jest.mock("../../src/modules/procurement/supplier_invoice/supplier_invoice.repo", () => ({
  getSI: jest.fn(), listLines: jest.fn(), update: jest.fn(),
  insertSI: jest.fn(), insertLine: jest.fn(), deleteLines: jest.fn(), listSI: jest.fn(),
  poTotal: jest.fn(), grnCountForPO: jest.fn(),
}));
jest.mock("../../src/modules/procurement/supplier-eligibility", () => ({
  assertSupplierUsable: jest.fn(),
}));
jest.mock("../../src/modules/finance/journal_entry/journal_entry.service", () => ({
  buildAndInsert: jest.fn(),
}));
jest.mock("../../src/services/documents/numbering.service", () => ({ allocate: jest.fn() }));
jest.mock("../../src/services/documents/document.service", () => ({ capture: jest.fn() }));
jest.mock("../../src/services/workflow/executor", () => ({ start: jest.fn() }));
jest.mock("../../src/services/workflow/on-approved", () => ({ register: jest.fn() }));
jest.mock("../../src/services/workflow/pending-guard", () => ({ assertNoPendingChain: jest.fn() }));
jest.mock("../../src/modules/procurement/goods_received/goods_received.service", () => ({
  list: jest.fn(), markMatched: jest.fn(),
}));
jest.mock("../../src/shared/config/settings", () => ({ getRule: jest.fn() }));
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(), audit: jest.fn() }));

const repo = require("../../src/modules/procurement/supplier_invoice/supplier_invoice.repo");
const eligibility = require("../../src/modules/procurement/supplier-eligibility");
const journal = require("../../src/modules/finance/journal_entry/journal_entry.service");
const numbering = require("../../src/services/documents/numbering.service");
const documents = require("../../src/services/documents/document.service");
const service = require("../../src/modules/procurement/supplier_invoice/supplier_invoice.service");

beforeEach(() => {
  jest.clearAllMocks();
  repo.getSI.mockResolvedValue({
    supplier_invoice_id: "si-1", status: "MATCHED", supplier_id: "sup-1",
    entity_id: "entity-1", supplier_ref: "INV-1", vat_total: 0, wht_total: 0,
  });
  repo.listLines.mockResolvedValue([{ label: "Freight", qty: 1, unit_price: 100, expense_account: "601" }]);
});

test("F10 posting rechecks exact supplier eligibility before any payable, number or document effect", async () => {
  eligibility.assertSupplierUsable.mockRejectedValueOnce(
    Object.assign(new Error("supplier not verified"), { code: "SUPPLIER_NOT_VERIFIED" }),
  );
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

  await expect(service.post(client, {
    supplierInvoiceId: "si-1", entryDate: "2026-08-17", actor: {},
  })).rejects.toMatchObject({ code: "SUPPLIER_NOT_VERIFIED" });

  expect(eligibility.assertSupplierUsable).toHaveBeenCalledWith(
    client, "sup-1", { required: true, lock: true },
  );
  expect(journal.buildAndInsert).not.toHaveBeenCalled();
  expect(numbering.allocate).not.toHaveBeenCalled();
  expect(documents.capture).not.toHaveBeenCalled();
  const verbs = client.query.mock.calls.map(([sql]) => String(sql).trim().toUpperCase());
  expect(verbs).toEqual(["BEGIN", "ROLLBACK"]);
});
