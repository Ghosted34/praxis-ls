/** Delivery note (MOD-32). Gated. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { requireTransitionPermission } = require("../../../shared/http/transition-permission");
const controller = require("./delivery_note.controller");
const validator = require("./delivery_note.validator");

const MODULE = "MOD-32";

/**
 * Which permission each target state needs.
 *
 * ISSUING burns the number and sends goods out — a `create`-class act.
 * DELIVERED is `edit`: it records something that happened at a gate, and the
 * person keying it in is usually not the person who raised the note.
 * CANCELLING a note a client may already hold is `approve`.
 *
 * Anything not listed falls back to `approve` (transition-permission.js), so a
 * state added later without updating this map fails closed.
 */
const TRANSITION_ACTION = {
  ISSUED: "create",
  DELIVERED: "edit",
  CANCELLED: "approve",
};

const router = express.Router();
router.use(authMiddleware);

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/summary", requirePermission(MODULE, "view"), controller.summary);
// Static before `/:id`, or "available-containers" is parsed as an id.
router.get("/available-containers", requirePermission(MODULE, "view"), controller.availableContainers);
// A create body prefilled from the file. `create`, not `view`: it is the first
// step of raising a note, and a read-only grant has no use for a draft it could
// not submit.
router.get("/prefill", requirePermission(MODULE, "create"), controller.prefill);
router.get("/:id", requirePermission(MODULE, "view"), controller.get);

router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.patch("/:id", requirePermission(MODULE, "edit"), validator.update, controller.update);

// Named transitions — the shape each one actually needs, validated by name.
router.post("/:id/issue", requirePermission(MODULE, "create"), validator.issue, controller.issue);
router.post("/:id/deliver", requirePermission(MODULE, "edit"), validator.deliver, controller.deliver);
router.post("/:id/cancel", requirePermission(MODULE, "approve"), validator.cancel, controller.cancel);

// The generic envelope. Mounted AFTER the validator so the target state is
// known before it picks its gate.
router.post("/:id/transition", validator.transition, requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);

module.exports = { basePath: "/delivery-notes", feature: null, router };
