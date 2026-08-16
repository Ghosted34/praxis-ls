"use strict";
module.exports = {
  MODULE: "MOD-20",
  CREATED: "quote_request.created",
  UPDATED: "quote_request.updated",
  CONVERTED: "quote_request.converted",
  ATTACHMENT_ADDED: "quote_request.attachment_added",
  ATTACHMENT_REMOVED: "quote_request.attachment_removed",
  transition: (status) => "quote_request." + String(status).toLowerCase(),
};
