"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./meeting.controller");
const validator = require("./meeting.validator");
const MODULE = "MOD-21";
const router = express.Router();
router.use(authMiddleware);

/**
 * Route order matters here: `/discovery/lead/:leadId` is declared BEFORE
 * `/:id`, because "discovery" would otherwise be read as a meeting id and
 * answer 404 for a route that exists.
 */
router.get("/discovery/lead/:leadId", requirePermission(MODULE, "view"), controller.latestForLead);
router.get("/discovery/client/:clientId", requirePermission(MODULE, "view"), controller.latestForClient);

// The probing questions are per-tenant configuration owned by whoever runs
// sales, not by whoever administers the application — so they sit on MOD-21's
// own grants rather than on the Settings module.
router.get("/discovery/prompts", requirePermission(MODULE, "view"), controller.listPrompts);
router.post("/discovery/prompts", requirePermission(MODULE, "create"), validator.prompt, controller.createPrompt);
router.patch("/discovery/prompts/:promptId", requirePermission(MODULE, "edit"), validator.promptPatch, controller.updatePrompt);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);
router.post("/:id/notes", requirePermission(MODULE, "edit"), validator.note, controller.addNote);

router.get("/:id/discovery", requirePermission(MODULE, "view"), controller.discovery);
router.put("/:id/discovery/:sectionKey", requirePermission(MODULE, "edit"), validator.sectionParam, validator.section, controller.saveSection);
// Dictation is `edit`, not a grant of its own: it writes the same field the
// keyboard writes. The AI-specific gate it needs — the `voice` feature, the
// per-user grant, the budget — is governance's, and is applied in the worker.
router.post("/:id/discovery/:sectionKey/dictate", requirePermission(MODULE, "edit"), validator.sectionParam, validator.dictate, controller.dictate);

module.exports = { basePath: "/meetings", feature: null, router };
