"use strict";
// Portals (Client / Investor / Auditor). Access grants are IAM-sensitive (MOD-67);
// each portal's data view is additionally feature-gated (portal.client/investor/audit).
module.exports = { MODULE: "MOD-67", ACCESS_GRANTED: "portal.access_granted", ACCESS_REVOKED: "portal.access_revoked" };
