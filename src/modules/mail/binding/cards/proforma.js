/**
 * Proforma card — the §7.3 worked example.
 *
 * The guide uses this exact card to state the missing-data rule, so it is the
 * one to read first: a thread that does not state an incoterm produces
 * "I can start a proforma but I need 2 things: Incoterm, Place of delivery",
 * with the button still labelled "Create proforma" — never a disabled control,
 * never a silently-incomplete form, and never a guessed default.
 */
"use strict";

module.exports = {
  key: "proforma",
  label_en: "Proforma",
  label_fr: "Facture proforma",
  target: "/finance/proforma/new",
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client" },
    { field: "incoterm", label: "Incoterm", why: "not stated in this thread" },
    { field: "delivery_place", label: "Place of delivery", why: "the dossier has no delivery place yet" },
  ],
  readOnly: true,
};
