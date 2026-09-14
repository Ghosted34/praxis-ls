/**
 * Tenant-side Support & Feedback (PRD §11.2). The tenant→Praxis channel: raise
 * support/bug/feature tickets, attach screenshots, and carry the thread with
 * Praxis (they reply in the console; we get the answer here). Ungated
 * (feature:null) — reaching Praxis for help must never be switched off.
 * Triage lives on the Platform Console (/api/platform/support/*).
 *
 * ATTACHMENTS ARE THE SAME TWO-STAGE AS EVERYWHERE ELSE (smartcomm media):
 * the bytes go up on their own request, the create/reply call links the ids.
 * A multipart body is parsed by multer, so `singleFile` must run BEFORE any
 * validator on that route — without it `req.body` would be empty.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { singleFile } = require("../../../shared/http/upload.middleware");
const { validate } = require("./support.validator");
const c = require("./support.controller");

const router = express.Router();
router.use(authMiddleware);

router.get("/tickets", c.list);
router.post("/tickets", validate("create"), c.create);
router.get("/tickets/:id", c.get);
router.post("/tickets/:id/replies", validate("reply"), c.reply);
router.post("/tickets/:id/csat", validate("csat"), c.csat);

router.post("/attachments", singleFile("file"), c.uploadAttachment);
// Reading one attachment is a read of the ticket it belongs to. NOT the
// unauthenticated /media/<key> static mount — the controller scopes it.
router.get("/attachments/:id", c.attachmentBytes);

module.exports = { basePath: "/support", feature: null, router };
