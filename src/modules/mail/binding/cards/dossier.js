/**
 * Dossier / shipment card — the file this correspondence is about.
 *
 * Read-only, like every v1 card. A thread bound to a client but not a file
 * offers to OPEN one, which is a deep-link into Operations rather than a write
 * from inside the mail UI.
 */
"use strict";

module.exports = {
  key: "dossier",
  label_en: "Dossier",
  label_fr: "Dossier",
  target: "/operations/dossiers/new",
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client" },
    { field: "service_type_id", label: "Service type", why: "the thread does not say what kind of job this is" },
  ],
  readOnly: true,
};
