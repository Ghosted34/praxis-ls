/**
 * Turning an email into an ERP record (§7.7).
 *
 * ── IT PREVIEWS. IT DOES NOT CREATE. ────────────────────────────────────────
 *
 * Q23 = B, "always confirm": this returns a prefill and a duplicate list, the
 * user reviews a form, and the record is saved through the TARGET module's own
 * service and validator. §3.4 is explicit that "a lead is created under MOD-26's
 * rights, not mail's" — so nothing here writes a business record. The only
 * thing it writes is the back-reference, once the target module reports what it
 * made.
 *
 * ── DUPLICATE DETECTION IS THE POINT ────────────────────────────────────────
 *
 * §7.7: "Duplicate detection runs BEFORE the form opens ... When a match is
 * found the dialog leads with 'Thierry at Camrail is already a lead (opened 3
 * days ago) — attach this email to it?' and makes Create new the SECONDARY
 * action."
 *
 * The previous implementation looked for a lead whose email was exactly equal
 * and nothing else, which misses every duplicate that actually happens: the
 * same company writing from a second address, a name spelled with or without
 * SARL, a person who moved from Gmail to a company domain. It now goes through
 * `master/_shared/dedup.service`, which already scores name-trigram, tax id,
 * email, phone and bank signals. Reusing it rather than re-deriving it is what
 * keeps mail's idea of "the same company" identical to Master Data's.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { audit, emitEvent } = require("../../../shared/events/emit");
const dedup = require("../../master/_shared/dedup.service");

const M = "MOD-72";

/**
 * The six targets §7.7 names, with the module whose rights govern the create.
 *
 * `party` says which dedup corpus to search. A quote request and a lead are
 * both a prospective CLIENT; a purchase requisition is a SUPPLIER matter; a
 * ticket and a task are neither, and duplicate-detecting support tickets by
 * company name would merge two unrelated problems.
 */
const TARGETS = {
  lead: { module: "MOD-26", route: "/sales/leads/new", party: "client", label_en: "Lead", label_fr: "Piste" },
  quote_request: { module: "MOD-25", route: "/sales/quote-requests/new", party: "client", label_en: "Quote request", label_fr: "Demande de devis" },
  enquiry: { module: "MOD-25", route: "/sales/enquiries/new", party: "client", label_en: "Contact enquiry", label_fr: "Demande de contact" },
  ticket: { module: "MOD-25", route: "/support/tickets/new", party: null, label_en: "Support ticket", label_fr: "Ticket" },
  task: { module: "MOD-72", route: "/workflow/tasks/new", party: null, label_en: "Task", label_fr: "Tâche" },
  purchase_requisition: { module: "MOD-56", route: "/procurement/requisitions/new", party: "supplier", label_en: "Purchase requisition", label_fr: "Demande d'achat" },
};

/** "Camrail SARL" is a company; "Thierry Mbarga" is not. */
const COMPANY_HINT = /\b(sarl|sas|sa|ltd|limited|llc|inc|gmbh|bv|plc|spa|srl|group|logistics|shipping|trading|industries|cie|co)\b\.?$/i;
const looksLikeCompany = (name) => Boolean(name && COMPANY_HINT.test(String(name).trim()));

/**
 * Everything the thread can honestly contribute to a new record.
 *
 * Nothing is inferred beyond what is written down: the counterparty's address
 * and display name, the subject, the first of the body, and the binding if the
 * thread has one. A company name guessed from an email domain is the kind of
 * help that produces a client called Gmail.
 */
async function threadFacts(client, threadId) {
  const { rows } = await client.query(
    `SELECT t.email_thread_id, t.subject, t.entity_ref,
            t.participants::text[] AS participants,
            m.from_address, m.from_name, m.body_text, m.received_at
       FROM email_thread t
       LEFT JOIN LATERAL (
         SELECT from_address, from_name, body_text, received_at
           FROM email_message
          WHERE email_thread_id = t.email_thread_id AND direction = 'IN'
          ORDER BY received_at
          LIMIT 1
       ) m ON true
      WHERE t.email_thread_id = $1`,
    [threadId],
  );
  const t = rows[0];
  if (!t) throw new AppError("NOT_FOUND", "thread not found", 404);

  const email = (t.from_address && String(t.from_address).toLowerCase())
    || (Array.isArray(t.participants) ? t.participants[0] : null)
    || null;

  return {
    thread_id: t.email_thread_id,
    subject: t.subject || null,
    entity_ref: t.entity_ref || null,
    email,
    // The display name is the PERSON, not the company. Conflating them is how a
    // client ends up named after whoever sent the first email.
    contact_name: t.from_name || null,
    company_name: looksLikeCompany(t.from_name) ? t.from_name : null,
    details: (t.body_text || "").slice(0, 2000) || null,
    received_at: t.received_at || null,
  };
}

/**
 * Preview a conversion: prefill, duplicates, and where the create happens.
 *
 * Never writes. `target_module` is the right the user will need, so the UI can
 * grey the option for someone who does not hold it rather than letting them
 * fill a form and be refused at the end.
 */
async function preview(client, threadId, target) {
  const spec = TARGETS[target];
  if (!spec) throw new AppError("VALIDATION_ERROR", `unknown conversion target "${target}"`, 422);

  const facts = await threadFacts(client, threadId);

  const duplicates = spec.party
    ? await dedup.findDuplicates(client, {
      kind: spec.party,
      input: { name: facts.company_name || facts.contact_name, email: facts.email },
      min: 55,
      cap: 5,
    }).catch(() => [])
    : [];

  return {
    target,
    target_module: spec.module,
    target_route: spec.route,
    label_en: spec.label_en,
    label_fr: spec.label_fr,
    prefill: {
      email: facts.email,
      contact_name: facts.contact_name,
      company_name: facts.company_name,
      subject: facts.subject,
      details: facts.details,
      entity_ref: facts.entity_ref,
      source: "MAIL",
    },
    duplicates,
    // §7.7: when a match is found the dialog LEADS with attaching to it, and
    // "Create new" becomes the secondary action. Stated in the payload so the
    // decision is not left to whoever writes the dialog.
    primary_action: duplicates.length ? "ATTACH_EXISTING" : "CREATE_NEW",
    hint: duplicates.length
      ? `${facts.contact_name || facts.email} may already exist. Attach this email to the existing record rather than creating a second one.`
      : null,
  };
}

/**
 * Record what the thread became, once the target module has made it.
 *
 * §7.7: "Conversion is bidirectional in the record: the created entity gets the
 * thread's entity_ref, and the thread shows what it became." Migration 10748
 * added `converted_entity_ref` and `converted_by` for this and nothing ever
 * wrote them, so the second half of that sentence was not true.
 *
 * Takes an `entityRef` rather than creating anything: mail records the link, it
 * does not make the record.
 */
async function recordConversion(client, threadId, entityRef, actor = {}) {
  if (!entityRef || !String(entityRef).includes(":")) {
    throw new AppError("VALIDATION_ERROR", "entity_ref is required, as kind:id", 422);
  }
  const { rows } = await client.query(
    `UPDATE email_thread
        SET converted_entity_ref = $2,
            converted_by = $3,
            -- Binding follows conversion: a thread that became a lead is about
            -- that lead. COALESCE, so it never overwrites a binding a human
            -- already chose.
            entity_ref = COALESCE(entity_ref, $2)
      WHERE email_thread_id = $1
      RETURNING email_thread_id, entity_ref, converted_entity_ref, converted_by`,
    [threadId, entityRef, actor.user_id || null],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "thread not found", 404);

  await emitEvent(client, {
    eventTypeKey: "email.thread.converted", moduleKey: M,
    entityRef: `email_thread:${threadId}`, actorUserId: actor.user_id || null,
    payload: { became: entityRef },
  }).catch(() => { /* @silent:storage the converted_entity_ref is the record */ });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "email.thread.converted",
    moduleKey: M, entityRef: `email_thread:${threadId}`, after: { became: entityRef },
  }).catch(() => { /* @silent:storage */ });

  return rows[0];
}

module.exports = { TARGETS, preview, recordConversion, threadFacts, looksLikeCompany };
