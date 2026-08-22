/** ISO 20275 + OHADA legal-form reference — universal, auth only. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const controller = require("./legal_form.controller");

const router = express.Router();
router.use(authMiddleware);
router.get("/", controller.list);
router.get("/:source/:country/:code", controller.get);

// Source, country and ELF/OHADA codes are reference text rather than row UUIDs.
module.exports = {
  basePath: "/legal-forms",
  feature: null,
  router,
  idParam: "text",
};
