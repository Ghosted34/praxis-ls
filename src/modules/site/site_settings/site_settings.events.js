"use strict";
/**
 * Website settings — theme, social links, partners, credentials, the group
 * About and leadership.
 *
 * MODULE KEY: MOD-29, the same key `site_content` and `service_type_web` ride,
 * and for the reason stated there: all administration of the tenant's public
 * face sits behind one permission rather than six. Splitting it would mean an
 * administrator who can write the homepage but not set its colours, which is
 * not a distinction anyone has asked for.
 *
 * `feature: "website"` is the separate commercial switch and it gates only the
 * PUBLIC read. This module is reachable without it, so a tenant can prepare a
 * site before the package is on — the same split `site_content.routes.js`
 * documents.
 */
module.exports = {
  MODULE: "MOD-29",
  THEME_UPDATED: "site.theme_updated",
  SOCIAL_UPDATED: "site.social_updated",
  PARTNER_CREATED: "site.partner_created",
  PARTNER_UPDATED: "site.partner_updated",
  PARTNER_DELETED: "site.partner_deleted",
  CREDENTIAL_CREATED: "site.credential_created",
  CREDENTIAL_UPDATED: "site.credential_updated",
  CREDENTIAL_DELETED: "site.credential_deleted",
  ABOUT_UPDATED: "site.about_updated",
  CAREERS_UPDATED: "site.careers_updated",
  LEADER_CREATED: "site.leader_created",
  LEADER_UPDATED: "site.leader_updated",
  LEADER_DELETED: "site.leader_deleted",
  ENTITY_STORY_UPDATED: "site.entity_story_updated",
};
