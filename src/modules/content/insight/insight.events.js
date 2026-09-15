"use strict";

/** Domain events for the insights module. MOD-29 is the website module — an
 *  article is website content, not a sales or an HR record. */
const MODULE = "MOD-29";

module.exports = {
  MODULE,
  CREATED: "insight.created",
  UPDATED: "insight.updated",
  DELETED: "insight.deleted",
  PUBLISHED: "insight.published",
  UNPUBLISHED: "insight.unpublished",
  // Pinning puts a piece on the tenant's front page. That is a publishing-grade
  // act and it gets a publishing-grade record: who pinned it, and until when.
  PINNED: "insight.pinned",
  UNPINNED: "insight.unpinned",
};
