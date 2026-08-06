/** Countries & jurisdiction profiles (§7). Reference data — auth only. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const controller = require("./country.controller");

const router = express.Router();
router.use(authMiddleware);
// No requirePermission: the ISO country list is universal reference data every
// party form (client AND supplier) needs; gating it behind one master module
// would lock the other side's users out of their own country picker.
router.get("/", controller.list);
router.get("/:code", controller.get);

// idParam:"text" — the path id is an ISO code, not a uuid, so the loader must
// not bind the uuid/number id guard to it.
module.exports = { basePath: "/countries", feature: null, router, idParam: "text" };
