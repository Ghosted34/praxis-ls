/** Master-data field configuration (§5.2/§5.3). Gated by the side configured. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./master_config.controller");

// The permission follows what is being configured: supplier config needs the
// supplier-master grant, client config the client-master grant.
const partyPerm = (action) => (req, res, next) =>
  requirePermission(String(req.params.appliesTo).toUpperCase() === "SUPPLIER" ? "MOD-04" : "MOD-03", action)(req, res, next);

const router = express.Router();
router.use(authMiddleware);
router.get("/:appliesTo", partyPerm("view"), controller.get);
router.put("/:appliesTo", partyPerm("edit"), controller.put);

// idParam:"text" — :appliesTo is CLIENT|SUPPLIER, not a row id.
module.exports = { basePath: "/master-config", feature: null, router, idParam: "text" };
