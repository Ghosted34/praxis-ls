/**
 * Who may be asked to sign a document (doc/SIGNATURE_ENGINEERING_GUIDE.md §6.3).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠  THIS FILE EXISTS SO THE SENDING SCREEN NEVER HAS TO TYPE AN ADDRESS.
 *
 *    Q7 = C is forbidden outright: there is no path in this programme where a
 *    signer supplies the address their own OTP is sent to. A signer states
 *    their NAME and ROLE; the address was put on file by the tenant, or typed
 *    by a tenant user who is named in the record and has to say why.
 *
 *    Without this resolver a "send for signature" screen has two choices, and
 *    both are wrong: make the operator retype the client's email (every send
 *    becomes an unattributed override, and the one-override cap stops meaning
 *    anything), or teach the FRONTEND that a transit order's counterparty is
 *    dossier → client_master → client_contact — business knowledge that would
 *    then live in a React component and drift from the server the first time a
 *    doc type changed shape.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── What a candidate is, and is not ────────────────────────────────────────
 * A candidate is a row we already hold, returned with the `source_ref` the
 * request will store (`client_contact:<uuid>`, `app_user:<uuid>`). It carries
 * `source: "ON_FILE"`, and creating a request from one leaves no override to
 * attribute. A party with no candidate is an OVERRIDE: the sender types the
 * address, the service stamps their user id on it, and the certificate prints
 * who stood behind it and why (§6.3). That path is deliberately available and
 * deliberately capped at one.
 *
 * ── Where the counterparty comes from ──────────────────────────────────────
 * `COUNTERPARTY_SQL`, one statement per doc type, resolving an `entity_ref` to
 * the party master the document is ABOUT. It is the same shape and the same
 * reasoning as `template.service.RECIPIENT_SQL` (which answers "where do I
 * email this?"); they are separate because they answer different questions —
 * a recipient is one address, a counterparty is a party with people on it.
 *
 * A doc type with no statement here returns internal signatories only, which
 * is the honest answer for a document that has no counterparty (a cash
 * request) rather than a guess.
 *
 * ── `dossier_visible`, not `dossier` ───────────────────────────────────────
 * The same call `transit_order.repo.SELECT_FULL` makes, for a stronger reason
 * here: a DRAFT file is half-finished wizard state, and the counterparty this
 * resolver names is the party we are about to EMAIL A SIGNING LINK TO. An order
 * hanging off an unfinished file resolves to nobody, which is the right answer
 * — and it is the same answer the operator's own screen gives, so the two
 * cannot disagree about who the client is.
 */
"use strict";

const { logger } = require("../../../config/logger");

/**
 * entity_ref → the client this document is about.
 *
 * A Map, and read through `.get`: `docType` originates in a query string, and
 * a plain object indexed by it answers `"constructor"` with a function —
 * truthy, callable, and past a `if (!sql) return` guard. Same class of finding
 * as canonical.js's BUILDERS (CodeQL js/unvalidated-dynamic-method-call, High).
 */
const COUNTERPARTY_SQL = new Map(Object.entries({
  TRANSIT_ORDER:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM transit_order t JOIN dossier_visible d ON d.dossier_id = t.dossier_id "
    + "JOIN client_master cm ON cm.client_id = d.client_id WHERE t.transit_order_id = $1",
  DELIVERY_NOTE:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM delivery_note dn JOIN dossier_visible d ON d.dossier_id = dn.dossier_id "
    + "JOIN client_master cm ON cm.client_id = d.client_id WHERE dn.delivery_note_id = $1",
  FINAL_INVOICE:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM invoice i JOIN client_master cm ON cm.client_id = i.client_id WHERE i.invoice_id = $1",
  PROFORMA_ADVANCE:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM advance a JOIN client_master cm ON cm.client_id = a.client_id WHERE a.advance_id = $1",
  QUOTATION:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM quotation q JOIN client_master cm ON cm.client_id = q.client_id WHERE q.quotation_id = $1",
  PROPOSAL:
    "SELECT cm.client_id AS party_id, cm.name AS party_name, cm.email AS party_email, cm.preferred_language AS party_language "
    + "FROM proposal p JOIN client_master cm ON cm.client_id = p.client_id WHERE p.proposal_id = $1",
}));

/** The record id inside an entity_ref (`transit_order:<uuid>`). */
const recordIdOf = (entityRef) => String(entityRef || "").split(":").slice(1).join(":") || null;

/**
 * The counterparty's contacts, newest-primary first.
 *
 * A contact with no email is DROPPED rather than returned disabled: this list
 * exists to answer "who can receive a signing link", and a row that cannot
 * receive one is not an answer to that question — offering it greyed out
 * invites the operator to override the address of somebody we already hold,
 * which is the one thing §6.3 is written to prevent.
 */
async function counterpartyFor(client, { docType, entityRef }) {
  const sql = typeof docType === "string" ? COUNTERPARTY_SQL.get(docType) : undefined;
  const recordId = recordIdOf(entityRef);
  if (!sql || !recordId) return null;
  try {
    const { rows } = await client.query(sql, [recordId]);
    const party = rows[0];
    if (!party) return null;

    const { rows: contacts } = await client.query(
      "SELECT contact_id, name, title, email, language, is_primary FROM client_contact "
      + "WHERE client_id = $1 AND is_active AND email IS NOT NULL "
      + "ORDER BY is_primary DESC, name",
      [party.party_id],
    );

    return {
      party_id: party.party_id,
      party_name: party.party_name,
      party_language: party.party_language || null,
      signatories: [
        ...contacts.map((c) => ({
          source: "ON_FILE",
          source_ref: `client_contact:${c.contact_id}`,
          full_name: c.name,
          party_role: c.title || null,
          email: c.email,
          language: c.language || party.party_language || null,
          is_primary: c.is_primary === true,
        })),
        /*
         * The party's own address, when it has one and no contact already
         * carries it. A great many client_master rows have an `email` and no
         * `client_contact` rows at all — for those tenants the alternative to
         * this entry is an override on every single send, which would empty
         * the one-override cap of meaning.
         *
         * It is ON_FILE and its `source_ref` is the client row, so the
         * certificate can still say exactly where the address came from.
         */
        ...(party.party_email && !contacts.some((c) => String(c.email).toLowerCase() === String(party.party_email).toLowerCase())
          ? [{
            source: "ON_FILE",
            source_ref: `client_master:${party.party_id}`,
            full_name: party.party_name,
            party_role: null,
            email: party.party_email,
            language: party.party_language || null,
            is_primary: contacts.length === 0,
          }]
          : []),
      ],
    };
  } catch (err) {
    // Best-effort: a screen that cannot list candidates must still offer the
    // attributed-override path, which is strictly better than refusing to send.
    logger.warn({ err: err && err.message, doc_type: docType, entity_ref: entityRef },
      "signature candidates: counterparty could not be resolved");
    return null;
  }
}

/**
 * Us. The internal signatories a countersignature can be requested from.
 *
 * Active users with an address, and nothing else — no role filter. Who inside
 * the company may attest to a document is an RBAC question (`MOD-64 approve`,
 * enforced when the signature is actually taken), not a list this resolver
 * gets to shorten. Someone without the grant simply cannot complete the
 * signature; hiding them here would make that failure silent and undebuggable.
 */
async function internalSignatories(client) {
  try {
    const { rows } = await client.query(
      "SELECT user_id, full_name, job_title, email FROM app_user "
      + "WHERE is_active AND email IS NOT NULL ORDER BY full_name",
    );
    return rows.map((u) => ({
      source: "ON_FILE",
      source_ref: `app_user:${u.user_id}`,
      full_name: u.full_name,
      party_role: u.job_title || null,
      email: u.email,
      language: null,
      is_primary: false,
    }));
  } catch (err) {
    logger.warn({ err: err && err.message }, "signature candidates: internal signatories could not be listed");
    return [];
  }
}

/**
 * Everyone this document could be sent to, split by side.
 *
 * @returns {Promise<{counterparty: object|null, internal: object[], can_override: boolean}>}
 */
async function list(client, { docType, entityRef }) {
  const [counterparty, internal] = await Promise.all([
    counterpartyFor(client, { docType, entityRef }),
    internalSignatories(client),
  ]);
  return {
    counterparty,
    internal,
    // Stated rather than implied, so the screen renders the cap as a rule
    // rather than discovering it as a 422 after the operator has typed.
    can_override: true,
    max_overrides: 1,
  };
}

module.exports = { list, counterpartyFor, internalSignatories, COUNTERPARTY_SQL, recordIdOf };
