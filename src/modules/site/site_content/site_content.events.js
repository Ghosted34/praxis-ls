/**
 * Tenant website content (migration 12753).
 *
 * MODULE KEY: MOD-29, the same key service_type_web rides and for the same
 * stated reason — all administration of the tenant's public face sits behind
 * one permission rather than three. It is a compromise, and the same one:
 * marketing copy is not dossier work, and this should move to its own module
 * key the day website administration needs to be separable from operations.
 *
 * `feature: "website"` is the separate, commercial switch, mounted on the
 * public router.
 */
"use strict";

module.exports = {
  MODULE: "MOD-29",
  PAGE_CREATED: "site.page_created",
  PAGE_UPDATED: "site.page_updated",
  PAGE_PUBLISHED: "site.page_published",
  PAGE_UNPUBLISHED: "site.page_unpublished",
  PAGE_DELETED: "site.page_deleted",
  BLOCK_CREATED: "site.block_created",
  BLOCK_UPDATED: "site.block_updated",
  BLOCK_DELETED: "site.block_deleted",
  BLOCKS_REORDERED: "site.blocks_reordered",
};
