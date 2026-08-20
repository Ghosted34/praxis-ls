/**
 * Purchase order card — the supplier-side counterpart.
 *
 * The only card that applies to a SUPPLIER thread rather than a client one,
 * which is why `appliesTo` keys off `supplier_id`: offering "raise a PO" on a
 * customer's complaint would be noise.
 */
"use strict";

module.exports = {
  key: "purchase_order",
  label_en: "Purchase order",
  label_fr: "Bon de commande",
  target: "/procurement/purchase-orders/new",
  appliesTo: (f) => Boolean(f.supplier_id),
  fields: [
    { field: "supplier_id", label: "Supplier", why: "this thread is not bound to a supplier" },
    { field: "dossier_id", label: "Dossier", why: "the thread does not say which file this is for" },
  ],
  readOnly: true,
};
