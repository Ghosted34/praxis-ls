/**
 * Service-type web profiles (guide §4.5 — rides the service-type module key).
 *
 * MODULE KEY: MOD-29, same as service_type itself. The dossier admin who can
 * edit a service type can also govern its public web face — "you can manage
 * operation files, you can manage the service types they use, and the
 * customer-facing version of those service types" reads as one coherent
 * permission rather than three. Revisit if web administration ever needs to
 * be separable from day-to-day dossier work.
 *
 * `feature: "website"` (the commercial switch) is a SEPARATE concern —
 * `requireFeature` is mounted on the public router, and the admin web routes
 * are mounted inside the service-type router which is gated on
 * `feature: "operations"`. Both halves gate on the same MOD-29 permission.
 */
"use strict";

module.exports = {
  MODULE: "MOD-29",
  CREATED: "service_type_web.profile_created",
  UPDATED: "service_type_web.profile_updated",
  PUBLISHED: "service_type_web.profile_published",
  UNPUBLISHED: "service_type_web.profile_unpublished",
  MEDIA_ADDED: "service_type_web.media_added",
  MEDIA_REMOVED: "service_type_web.media_removed",
  FAQ_UPDATED: "service_type_web.faq_updated",
  RELATED_UPDATED: "service_type_web.related_updated",
  GROUP_CREATED: "service_type_web.group_created",
  GROUP_UPDATED: "service_type_web.group_updated",
  GROUP_DELETED: "service_type_web.group_deleted",
};
