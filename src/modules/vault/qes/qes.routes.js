/**
 * QES reads (MOD-64) — the Tier 3 pre-flight and the tenant's usage view.
 *
 * RBAC maps onto the tenant's fixed five-action vocabulary:
 *   view   — the usage panel (Settings → Signatures → Certified signatures)
 *   create — the dispatch pre-flight: it is the sender's question ("may I
 *            send this for certified signature?"), asked before a request
 *            exists, so it sits with `create`, not `view`
 *
 * The whole write side of Tier 3 is NOT here: the handoff lives on the
 * public signing page (the token is the credential, guide §6.6) and the
 * webhook lives in qes_public (no auth, rate-limited, pinned to live).
 * These two routes are the tenant's own questions about the provider.
 *
 * Gated on `signatures` — the base module — and NOT on `signatures.qes`,
 * on purpose. The first question this module answers is "is certified
 * signing switched on?", and a gate that 403s when the answer is no would
 * make the Settings panel unable to render its disabled state. The flag
 * restricts the ACTION (the menu will not offer the card, the handoff
 * refuses it); it does not hide the question.
 */
"use strict";

const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const controller = require("./qes.controller");
const validator = require("./qes.validator");

const MODULE = "MOD-64";
const router = express.Router();

router.use(authMiddleware);

// Declared before any :id-shaped route in this family: the module loader
// reports resolved URLs, and a literal path always wins over a pattern at
// request time anyway, but the order keeps a future reader honest.
router.get("/quote", requirePermission(MODULE, "create"), validator.quote, controller.quote);
router.get("/usage", requirePermission(MODULE, "view"), validator.usage, controller.usage);

module.exports = { basePath: "/signatures/qes", feature: "signatures", router };
