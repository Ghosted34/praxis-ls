/** God Mode CEO purge console (MOD-00B). CEO-only, always audited. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requireCeo } = require("../../../middleware/rbac");
const c = require("./godmode.controller");
const v = require("./godmode.validator");
const router = express.Router();
router.use(authMiddleware, requireCeo());
router.get("/soft-deletes", c.list);
// G24 — CEO sets/rotates their own God-Mode PIN; the stored hash is Argon2id
// and the row carries an expiry (rotation is also automated weekly).
router.post("/pin", v.setPin, c.setPin);
// G5 — dependency preview before any purge decision (meeting §11.2): the
// record, its immutable-ledger references (unpurgeable when > 0), and every
// FK child discovered from the catalogue. `:id` is the soft_delete_id; the
// module-loader's global idParamGuard validates it.
router.get("/:id/dependencies", c.dependencies);
router.post("/purge", v.purge, c.purge);
module.exports = { basePath: "/god-mode", feature: null, router };
