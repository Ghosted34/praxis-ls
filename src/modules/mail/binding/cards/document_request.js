/**
 * Document request card — "chase missing documents".
 *
 * Unlike the other six this one does not deep-link into another module: the
 * action is composing a message, which is where the operator already is. §7.6:
 * the composer opens prefilled with "a bilingual list of exactly the
 * outstanding items, in the client's preferred_language, from a tenant-editable
 * snippet".
 *
 * It is ready as soon as there is a client, because the checklist is computed
 * rather than typed — the Documents tab already knows what is missing.
 */
"use strict";

module.exports = {
  key: "document_request",
  label_en: "Request documents",
  label_fr: "Demander des documents",
  target: "/comms/mail?compose=chase",
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client" },
  ],
  readOnly: true,
};
