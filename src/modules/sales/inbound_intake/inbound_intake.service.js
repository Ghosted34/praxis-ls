/**
 * Inbound intake (MOD-25) — the contact enquiry desk (F9,
 * doc/SALES_CRM_FEATURES.md), plus the partnership functions F10 is moving out.
 *
 * A message from the website's contact form arrives, gets classified, gets
 * answered, and either closes or becomes a lead — or, when it is a partnership
 * offer, a partnership request in F10's register.
 *
 * FOUR THINGS THIS LAYER IS RESPONSIBLE FOR.
 *
 * 1. STATUS IS THE CORRESPONDENCE, AND NOTHING ELSE. Every status move goes
 *    through `transition`, which asserts the move against
 *    `rules.NEXT` — there is no path that writes `status` from a patch body.
 *    The old shape had triage write `TRIAGED` or `CLOSED` directly, which is
 *    both an unguarded free-text status write (Block A forbids porting those)
 *    and the overloaded column F9 exists to unpick.
 *
 * 2. TRIAGE DOES NOT TOUCH THE STATUS. Raising a lead from an enquiry is not an
 *    answer to the person who wrote in. Under the old shape it silently moved
 *    the row out of the unread pile, so an enquiry could be "handled" with
 *    nobody ever replying. Triage now writes `lead_id` /
 *    `partnership_request_id` and leaves the correspondence exactly where it
 *    was.
 *
 * 3. A REPLY IS SENT, AND THE ATTEMPT SURVIVES ITS OWN FAILURE. `respond` puts
 *    a PENDING row down and COMMITS it before calling the mail engine, then
 *    settles it to SENT or FAILED. So a reply that dies mid-send — process
 *    restart, SMTP timeout with no answer — leaves a visible "we tried" row
 *    instead of nothing, and the operator is not retrying blind. Only a SENT
 *    row moves the enquiry to RESPONDED, which is what makes the Responded tile
 *    mean something.
 *
 *    The dual-write hazard is real and is stated rather than hidden: the mail
 *    is out of our hands the moment nodemailer returns, so a crash between the
 *    send and the settle leaves a PENDING row against a delivered email. That
 *    is why PENDING is a visible state on the screen and not an internal one —
 *    the honest answer to "did this go out" is sometimes "we do not know", and
 *    `email_send_log` (written by email.service on every attempt) is where the
 *    operator settles it.
 *
 * 4. THE KPI TILES PARTITION. `list` folds the GROUP BY through `rules.kpiFrom`
 *    and asserts the tiles sum to TOTAL before the response leaves.
 */
"use strict";
const repo = require("./inbound_intake.repo");
const events = require("./inbound_intake.events");
const rules = require("./inbound_intake.rules");
// BOTH destinations are reached through their REPO, never their service, and
// this is not a style choice. `lead.service.create` and every other create in
// this codebase open and COMMIT their own BEGIN/COMMIT — calling one from
// inside the transaction below would commit the outer transaction at the lead
// insert, so a failure on the enquiry update afterwards would leave a lead in
// the funnel that no enquiry points at. That is the "converted computed two
// ways" defect F6 spent a slice correcting, and the shape this file had before
// F9 reproduced it exactly. The events and audit rows those services would have
// emitted are emitted here under the SAME keys, so nothing downstream loses a
// record.
const leadRepo = require("../lead/lead.repo");
const leadEvents = require("../lead/lead.events");
const partnershipRepo = require("../partnership_request/partnership_request.repo");
const partnershipEvents = require("../partnership_request/partnership_request.events");
const emailService = require("../../../services/email.service");
const { mapSmtpError, isSmtpError } = require("../../mail/mail/smtp-error.map");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const { atomically } = require("../../../shared/db/tx");

const ref = (id) => "contact_enquiry:" + id;

/** Rows a CSV export will stream before it tells the caller it truncated. */
const EXPORT_CAP = 10000;

/**
 * Replies go out under the SUPPORT identity, not NOTIFICATIONS.
 *
 * A human wrote this text to a member of the public who wrote to us first, so
 * it must come from an address that accepts a reply. NOTIFICATIONS resolves to
 * the no-reply sender, and answering a contact form from no-reply@ is how the
 * conversation ends.
 */
const MAIL_PURPOSE = "SUPPORT";

/* ─── intake ──────────────────────────────────────────────────────────────── */

async function submitEnquiry(client, { data, actor = {} }) {
  return atomically(client, async () => {
    const row = await repo.insertEnquiry(client, data);
    await emitEvent(client, {
      eventTypeKey: events.ENQUIRY_CREATED, moduleKey: events.MODULE,
      entityRef: ref(row.contact_enquiry_id), actorUserId: actor.user_id || null,
    });
    return row;
  });
}

/* ─── lifecycle ───────────────────────────────────────────────────────────── */

/**
 * The ONLY path that writes `status`. Guarded, audited, and it names the move
 * it made rather than logging a generic "updated".
 */
async function transition(client, { id, to, actor = {} }) {
  const before = await repo.getEnquiry(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  rules.assertTransition(before.status, to);
  const row = await repo.updEnquiry(client, id, { status: to });
  const key = events.enquiryTransition(before.status, to);
  await emitEvent(client, { eventTypeKey: key, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: key, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Opening the message marks it read — the legacy drawer does this on open and
 * it is the behaviour that makes the "New (unread)" tile mean anything.
 *
 * Idempotent and non-throwing on anything that is not NEW: this fires from a
 * screen opening, and a READ enquiry being opened again is not an error the
 * operator should be shown. Only NEW -> READ is a real move.
 */
async function markRead(client, { id, actor = {} }) {
  const before = await repo.getEnquiry(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  if (before.status !== "NEW") return before;
  return transition(client, { id, to: "READ", actor });
}

/** Notes and classification. Never status, never the triage links — see WRITABLE. */
async function updateEnquiry(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getEnquiry(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  if (rules.isClosed(before.status)) {
    throw new AppError("LOCKED", "Reopen this enquiry before editing it", 422);
  }
  const fields = {};
  for (const k of repo.WRITABLE) if (patch[k] !== undefined) fields[k] = patch[k];
  if (!Object.keys(fields).length) return before;
  const row = await repo.updEnquiry(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.ENQUIRY_UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/* ─── replying ────────────────────────────────────────────────────────────── */

/**
 * Answer an enquiry by email, and record the attempt.
 *
 * The sequence is deliberate and each step is load-bearing:
 *
 *   1. Validate. No address, no reply — a "responded" enquiry with nowhere to
 *      have sent it would be a lie the tile then counts.
 *   2. Write the attempt PENDING and COMMIT it. This is the record that
 *      survives a crash during the send.
 *   3. Send. `email.service.send` resolves the tenant's own SUPPORT identity,
 *      falls back to the platform sender when the tenant has configured no
 *      SMTP of their own, and writes `email_send_log` either way.
 *   4a. Sent  -> settle the row SENT with the provider message id, and move the
 *       enquiry to RESPONDED (via `transition`, so the move is still guarded).
 *   4b. Failed -> settle the row FAILED with the error, emit the failure event,
 *       and raise the mapped SMTP error. THE STATUS DOES NOT MOVE. An operator
 *       whose reply bounced must still see the enquiry as unanswered.
 */
async function respond(client, { id, body, subject = null, actor = {} }) {
  const before = await repo.getEnquiry(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  if (rules.isClosed(before.status)) {
    throw new AppError("LOCKED", "Reopen this enquiry before replying to it", 422);
  }
  if (!before.email) {
    throw new AppError(
      "NO_REPLY_ADDRESS",
      "This enquiry carries no email address — record the outcome in the notes and close it instead",
      422,
      { email: ["the enquiry was submitted without one"] },
    );
  }
  rules.assertTransition(before.status, "RESPONDED");

  const to = String(before.email);
  const subj = subject || ("Re: " + (before.subject || "your enquiry"));

  // Step 2 — committed on its own, before anything leaves the building.
  const attempt = await repo.insertResponse(client, {
    contact_enquiry_id: id,
    to_address: to,
    subject: subj,
    body,
    created_by_user_id: actor.user_id || null,
  });

  let info;
  try {
    info = await emailService.send(client, {
      to,
      subject: subj,
      text: body,
      html: htmlBody(body),
      purpose: MAIL_PURPOSE,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      // §3.5. A reply to a website enquiry is the first thing a prospect ever
      // receives from us, and it is the send point a tenant most reliably wants
      // on a sales address rather than the generic notifications one.
      sendPoint: "intake.reply",
    });
  } catch (err) {
    await repo.settleResponse(client, attempt.contact_enquiry_response_id, {
      send_status: "FAILED",
      error: (err && err.message) ? String(err.message).slice(0, 2000) : "unknown send failure",
    });
    await emitEvent(client, { eventTypeKey: events.ENQUIRY_RESPONSE_FAILED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ENQUIRY_RESPONSE_FAILED, moduleKey: events.MODULE, entityRef: ref(id), after: { contact_enquiry_response_id: attempt.contact_enquiry_response_id, error: err && err.message } });
    logger.error({ err, enquiryId: id }, "[enquiry] reply could not be sent");
    // A mapped SMTP error tells the operator WHICH thing to fix (auth, host,
    // recipient refused) instead of surfacing nodemailer's wording.
    throw isSmtpError(err) ? mapSmtpError(err) : new AppError("EMAIL_SEND_FAILED", "The reply could not be sent: " + (err && err.message), 502);
  }

  const settled = await repo.settleResponse(client, attempt.contact_enquiry_response_id, {
    send_status: "SENT",
    provider_message_id: (info && (info.messageId || info.message_id)) || null,
    sent_at: new Date().toISOString(),
  });

  const row = await repo.updEnquiry(client, id, {
    status: "RESPONDED",
    responded_at: new Date().toISOString(),
    responded_by_user_id: actor.user_id || null,
  });
  await emitEvent(client, { eventTypeKey: events.ENQUIRY_RESPONDED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ENQUIRY_RESPONDED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });

  return { enquiry: row, response: settled };
}

/** Plain text to a minimal HTML part. No template, no branding — this is a
 *  person's own words, and wrapping them in a marketing shell misrepresents
 *  who is writing. */
function htmlBody(text) {
  const esc = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return "<div style=\"font-family:Roboto,'Noto Sans',sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap\">" + esc + "</div>";
}

/* ─── triage ──────────────────────────────────────────────────────────────── */

/**
 * Route an enquiry into the funnel.
 *
 * `to_lead` keeps the conversion this system has and the legacy does not.
 * `to_partnership` is new: a PARTNERSHIP-typed message belongs in F10's
 * register, and without this the same enquiry gets worked twice — once here and
 * once by whoever re-keys it into the partnership desk.
 *
 * ROUTING TO PARTNERSHIP IS ALSO A CLASSIFICATION. If the enquiry was not typed
 * PARTNERSHIP, this sets the type as part of the same act: deciding it belongs
 * in the partnership register IS deciding what kind of message it is, and
 * leaving the two to disagree would make the type filter lie about the row.
 *
 * `close` is NOT a status write here — it goes through `transition`, so the
 * guard applies, and it is skipped silently when the move is not legal rather
 * than failing the whole triage that already succeeded.
 *
 * Both writes and the status move share ONE transaction.
 */
async function triageEnquiry(client, { id, toLead = false, toPartnership = false, close = false, actor = {} }) {
  const e = await repo.getEnquiry(client, id);
  if (!e) throw new AppError("NOT_FOUND", "Enquiry not found", 404);

  await client.query("BEGIN");
  try {
    const fields = {};
    let leadId = e.lead_id;
    let partnershipId = e.partnership_request_id;

    if (toLead && !leadId) {
      const lead = await leadRepo.insert(client, {
        entity_id: null,
        company_name: e.company_name || e.name || "Website enquiry",
        contact_name: e.name || null,
        email: e.email || null,
        phone: e.phone || null,
        country: null,
        address: null,
        niu: null,
        rccm: null,
        source: "WEBSITE",
        intake_channel: "WEBSITE",
        service_interest: e.subject || null,
        client_type_hint: null,
        payment_terms_days: null,
        status: "NEW",
        owner_user_id: actor.user_id || null,
        details_json: JSON.stringify({ from_contact_enquiry: id }),
      });
      leadId = lead.lead_id;
      fields.lead_id = leadId;
      await emitEvent(client, { eventTypeKey: leadEvents.CREATED, moduleKey: leadEvents.MODULE, entityRef: "lead:" + leadId, actorUserId: actor.user_id || null });
      await audit(client, { actorUserId: actor.user_id || null, action: leadEvents.CREATED, moduleKey: leadEvents.MODULE, entityRef: "lead:" + leadId, after: lead });
    }

    if (toPartnership && !partnershipId) {
      const pr = await partnershipRepo.insert(client, {
        company_name: e.company_name || e.name || "Website enquiry",
        contact_name: e.name || null,
        email: e.email,
        contact_phone: e.phone,
        proposal_text: e.message,
        intake_channel: "WEBSITE",
      });
      partnershipId = pr.partnership_request_id;
      fields.partnership_request_id = partnershipId;
      // The classification and the routing agree, always — see the note above.
      if (e.enquiry_type !== "PARTNERSHIP") fields.enquiry_type = "PARTNERSHIP";
      await emitEvent(client, { eventTypeKey: partnershipEvents.CREATED, moduleKey: partnershipEvents.MODULE, entityRef: "partnership_request:" + partnershipId, actorUserId: actor.user_id || null });
      await audit(client, { actorUserId: actor.user_id || null, action: partnershipEvents.CREATED, moduleKey: partnershipEvents.MODULE, entityRef: "partnership_request:" + partnershipId, after: pr });
    }

    let row = Object.keys(fields).length ? await repo.updEnquiry(client, id, fields) : e;

    if (fields.lead_id) {
      await emitEvent(client, { eventTypeKey: events.ENQUIRY_ROUTED_TO_LEAD, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    }
    if (fields.partnership_request_id) {
      await emitEvent(client, { eventTypeKey: events.ENQUIRY_ROUTED_TO_PARTNERSHIP, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: "contact_enquiry.triaged", moduleKey: events.MODULE, entityRef: ref(id), before: e, after: { lead_id: leadId, partnership_request_id: partnershipId } });

    // The status move, guarded like every other. Not legal from here (already
    // CLOSED) means there is nothing to do, not that the triage failed.
    if (close && rules.NEXT[row.status] && rules.NEXT[row.status].includes("CLOSED")) {
      row = await transition(client, { id, to: "CLOSED", actor });
    }

    await client.query("COMMIT");
    return { enquiry: row, lead_id: leadId, partnership_request_id: partnershipId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/* ─── reads ───────────────────────────────────────────────────────────────── */

/**
 * List + the KPI tiles.
 *
 * The fold lives in `rules.kpiFrom`, which derives one tile per status from the
 * status list itself, and `assertPartitions` proves the tiles add up to TOTAL
 * before the response leaves. The legacy hand-lists four tiles against four
 * statuses and omits READ, so every opened-but-unanswered message is counted
 * into Total and shown in no tile.
 */
async function listEnquiries(client, q = {}) {
  const { rows, total, kpiRows, limit, offset } = await repo.listEnquiries(client, q);
  const kpi = rules.kpiFrom(kpiRows);
  rules.assertPartitions(kpi);
  return { rows, total, kpi, limit, offset };
}

async function getEnquiry(client, id) {
  const row = await repo.getEnquiry(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Enquiry not found", 404);
  return { ...row, responses: await repo.listResponses(client, id) };
}

/** Every matching row, for the CSV export. `truncated` is reported, never hidden. */
const listEnquiriesForExport = (client, q = {}) => repo.listEnquiriesForExport(client, q, EXPORT_CAP);

/* ─── partnership requests ────────────────────────────────────────────────
 *
 * MOVED in F10 to src/modules/sales/partnership_request/ (basePath
 * /partnership-requests). F9 left these here marked "F10 territory"; this is
 * F10 collecting them.
 *
 * They could not stay: migration 0688 replaces the table's status vocabulary
 * with the legacy API's own NEW / IN_REVIEW / APPROVED / REJECTED, so the
 * `review` validator below — REVIEWING / ACCEPTED / DECLINED — now writes
 * values the CHECK constraint refuses. An endpoint that 23514s on every call
 * is not a back-compatible alias.
 *
 * Triage still raises a partnership request: it does it through
 * partnership_request.repo, above, which is the F10 register.
 */

module.exports = {
  submitEnquiry, transition, markRead, updateEnquiry, respond, triageEnquiry,
  listEnquiries, getEnquiry, listEnquiriesForExport,
  EXPORT_CAP, MAIL_PURPOSE,
};
