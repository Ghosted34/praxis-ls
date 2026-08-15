/**
 * Marketing campaign (MOD-22) — event and audit keys.
 *
 * Every key here is registered in `event_type` by migrations/tenant/0685, which
 * is what makes them selectable in the notification and workflow designers. The
 * module emitted campaign.created and campaign.<status> from the day it was
 * written and none of them were ever seeded, so the designer offered no
 * campaign event at all — the events existed and nothing could subscribe.
 *
 * `campaign.submitted` is marked approvable in that seed: it is the event a
 * tenant would bind an approval workflow to if they later want budget
 * thresholds routing to different approvers. F8 ships the simpler control — the
 * `approve` permission on MOD-22 — but emitting the event under a name the
 * engine already recognises is what keeps that door open without a migration.
 */
"use strict";
module.exports = {
  MODULE: "MOD-22",
  CREATED: "campaign.created",
  UPDATED: "campaign.updated",
  SUBMITTED: "campaign.submitted",
  APPROVED: "campaign.approved",
  REJECTED: "campaign.rejected",
  ACTUALS_RECORDED: "campaign.actuals_recorded",
  SUBSCRIBED: "newsletter.subscribed",
  UNSUBSCRIBED: "newsletter.unsubscribed",
  transition: (status) => "campaign." + String(status).toLowerCase(),
};
