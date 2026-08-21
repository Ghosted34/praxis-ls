/**
 * Quotation card.
 *
 * Deliberately does NOT require a price. Pricing is a decision that belongs in
 * Commercial with its own approval chain (BUILD_CONVENTIONS §1–§5); a mail card
 * that asked for an amount would be inviting someone to quote from an inbox.
 */
"use strict";

module.exports = {
  key: "quotation",
  label_en: "Quotation",
  label_fr: "Devis",
  target: "/commercial/quotations/new",
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client" },
    { field: "service_type_id", label: "Service type", why: "the thread does not say what is being quoted" },
  ],
  readOnly: true,
};
