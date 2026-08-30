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
};
