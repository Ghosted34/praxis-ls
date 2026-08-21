/**
 * The facts a card is allowed to reason about.
 *
 * ONE query, shared by all seven cards, rather than one per card: the reading
 * pane may render several cards on a thread and §3.6's budget does not stop
 * applying because the drawer is not the thing on screen.
 *
 * Everything here comes from the thread and the record it is BOUND to. Nothing
 * is inferred from the message body — §7.3 is explicit that a card must not
 * "guess a missing value, substitute a default, or open a form silently missing
 * fields. If the thread does not say the incoterm, the card says the thread
 * does not say the incoterm."
 */
"use strict";

const SQL = `
  SELECT t.email_thread_id, t.entity_ref, t.subject,
         t.participants::text[] AS participants,
         c.client_id, c.name AS client_name,
         c.payment_terms_days, c.preferred_language,
         d.dossier_id, d.ref AS dossier_ref, d.incoterm, d.delivery_place,
         d.service_type_id, d.client_id AS dossier_client_id,
         s.supplier_id, s.name AS supplier_name
    FROM email_thread t
    LEFT JOIN client_master   c ON t.entity_ref = 'client:'   || c.client_id::text
    LEFT JOIN dossier_visible d ON t.entity_ref = 'dossier:'  || d.dossier_id::text
    LEFT JOIN supplier_master s ON t.entity_ref = 'supplier:' || s.supplier_id::text
   WHERE t.email_thread_id = $1`;

/**
 * Flatten the row into the field names the cards ask for.
 *
 * Note what is NOT here: a currency. `client_master` does not carry one — the
 * currency of a document is decided by the corporate entity and the finance
 * module's own defaults, not by the counterparty. A card that asked the
 * operator to supply it would be asking them to answer a question the target
 * module already answers better.
 *
 * A dossier-bound thread carries its client through the dossier — §7.5:
 * "dossier-bound threads show the dossier first with its client behind it" —
 * so `client_id` resolves either way and a card bound to a file does not have
 * to be told separately who the file belongs to.
 */
async function factsFor(client, threadId) {
  const { rows } = await client.query(SQL, [threadId]).catch(() => ({ rows: [] }));
  const r = rows[0];
  if (!r) return null;
  return {
    thread_id: r.email_thread_id,
    entity_ref: r.entity_ref,
    subject: r.subject,
    participants: Array.isArray(r.participants) ? r.participants : [],
    client_id: r.client_id || r.dossier_client_id || null,
    client_name: r.client_name || null,
    payment_terms_days: r.payment_terms_days ?? null,
    language: r.preferred_language || null,
    dossier_id: r.dossier_id || null,
    dossier_ref: r.dossier_ref || null,
    incoterm: r.incoterm || null,
    delivery_place: r.delivery_place || null,
    service_type_id: r.service_type_id || null,
    supplier_id: r.supplier_id || null,
    supplier_name: r.supplier_name || null,
  };
}

module.exports = { factsFor, SQL };
