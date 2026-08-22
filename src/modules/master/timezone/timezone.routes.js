/** Complete IANA timezone reference — auth only, no tenant permission. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const controller = require("./timezone.controller");

const router = express.Router();
router.use(authMiddleware);
// Every authenticated form may need this universal reference data. The wildcard
// lets GET /timezones/Africa/Douala address an IANA id containing a slash.
router.get("/", controller.list);
router.get("/*", controller.get);

module.exports = {
  basePath: "/timezones",
  feature: null,
  router,
  idParam: "text",
};
