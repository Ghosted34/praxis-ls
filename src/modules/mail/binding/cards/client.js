/**
 * Client card — who this correspondence is with.
 *
 * The one card with no "create" action: a thread bound to a client does not
 * imply anything should be made. It deep-links to the record so an operator can
 * see terms and history without leaving the reading pane.
 */
"use strict";

module.exports = {
  key: "client",
  label_en: "Client",
  label_fr: "Client",
  target: "/master/clients/:client_id",
  /** Shown when the thread is bound to a client, or to that client's dossier. */
  appliesTo: (f) => Boolean(f.client_id),
  fields: [
    { field: "client_id", label: "Client", why: "this thread is not bound to a client yet" },
  ],
  // Read-only: v1 cards read, they do not write (Q20).
  readOnly: true,
};
