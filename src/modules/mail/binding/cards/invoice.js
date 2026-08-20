/**
 * Invoice card.
 *
 * Requires a DOSSIER, not just a client: an invoice with no file behind it has
 * nothing to cost against and nowhere to land on the margin. Saying so is more
 * useful than opening a form that cannot be completed.
 */
"use strict";

module.exports = {
  key: "invoice",
  label_en: "Invoice",
  label_fr: "Facture",
  target: "/finance/invoices/new",
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client" },
    { field: "dossier_id", label: "Dossier", why: "an invoice needs the file it is billing for" },
  ],
  readOnly: true,
};
