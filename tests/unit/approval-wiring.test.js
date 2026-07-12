"use strict";
/**
 * Step 1 — the tenant's configurable approval workflow governs EVERY approvable
 * document, not just the final invoice (BUILD_CONVENTIONS §2/§5, PRD §7.2).
 * Requiring each module service registers its onApproved handler as a side
 * effect; this asserts the whole set is wired so a cleared chain posts/approves
 * the right record.
 */
const onApproved = require("../../src/services/workflow/on-approved");

// Requiring the services runs their onApproved.register(...) calls.
require("../../src/modules/finance/final_invoice/final_invoice.service");
require("../../src/modules/costing/costing/costing.service");
require("../../src/modules/procurement/purchase_order/purchase_order.service");
require("../../src/modules/hr/payroll/payroll.service");
require("../../src/modules/costing/cash_request/cash_request.service");
require("../../src/modules/procurement/supplier_invoice/supplier_invoice.service");

describe("approval workflow is generalised across approvable documents", () => {
  const expected = ["invoice", "costing", "purchase_order", "payroll_run", "cash_request", "supplier_invoice"];

  it.each(expected)("registers an onApproved handler for '%s'", (prefix) => {
    expect(typeof onApproved.handlerFor(prefix + ":x")).toBe("function");
  });

  it("dispatches a cleared chain to the owning module handler", async () => {
    // A fake entity_ref with no matching handler is a no-op; a known prefix routes.
    expect(onApproved.handlerFor("nonexistent:1")).toBeNull();
    expect(onApproved.handlerFor("purchase_order:1")).not.toBeNull();
  });
});
