"use strict";
/**
 * Event keys for the enquiry desk (F9) and, until F10 moves them out, the
 * partnership register.
 *
 * Every key here is registered in `event_type` by migration 0689 (enquiries) —
 * `event_log.event_type_key` carries no FK, so an unregistered key logs happily
 * and is then invisible to the workflow designer and the notification rules,
 * which is worse than failing because nothing reports it.
 *
 * There is deliberately NO `contact_enquiry.triaged`. Triage produces a lead or
 * a partnership request, and those are two different facts with two different
 * downstream audiences — one key covering both is how a notification rule ends
 * up firing at the wrong desk.
 */
module.exports = {
  MODULE: "MOD-25",

  ENQUIRY_CREATED: "contact_enquiry.created",
  ENQUIRY_UPDATED: "contact_enquiry.updated",
  ENQUIRY_READ: "contact_enquiry.read",
  ENQUIRY_RESPONDED: "contact_enquiry.responded",
  ENQUIRY_RESPONSE_FAILED: "contact_enquiry.response_failed",
  ENQUIRY_CLOSED: "contact_enquiry.closed",
  ENQUIRY_REOPENED: "contact_enquiry.reopened",
  ENQUIRY_ROUTED_TO_LEAD: "contact_enquiry.routed_to_lead",
  ENQUIRY_ROUTED_TO_PARTNERSHIP: "contact_enquiry.routed_to_partnership",

  /** Reopening is READ-from-CLOSED, and says so rather than logging a second
   *  `read` that reads like somebody just opened the message again. */
  enquiryTransition: (from, to) =>
    (from === "CLOSED" && to === "READ" ? "contact_enquiry.reopened" : "contact_enquiry." + String(to).toLowerCase()),

  // partnership_request.* keys live in sales/partnership_request.events (F10).
  // Triage emits the CREATED one through that module, so the two registers
  // cannot drift into two spellings of the same fact.
};
