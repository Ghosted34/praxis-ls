/**
 * Document-template routes. Two different audiences share this router, and
 * conflating them was a bug:
 *
 *   · the template STUDIO — list templates, read/save the per-(docType, entity)
 *     config. That is tenant configuration and stays gated on MOD-70 (Settings).
 *
 *   · the document VIEWER — `DocumentPage` (the View button on every finance,
 *     procurement, HR, fleet, WMS and operations record) renders through
 *     `POST /:docType/preview`, and Download PDF through `/generate`. These are
 *     ordinary users reading their own records.
 *
 * Everything was on MOD-70 because the router began life as the Studio. The
 * consequence: opening a purchase request you had just created required the
 * Settings permission, so every non-administrator got "You don't have
 * permission to do this" on their own document, with no way to fix it from
 * their side. Session 16 rolled the View button out across ~20 screens, which
 * multiplied the blast radius.
 *
 * Reading or generating a document now follows the module that OWNS that doc
 * type (`document_vault.types.moduleKeyForDocType`) — a purchase request
 * needs MOD-62 view, an invoice MOD-51 view. Same principle as
 * approval_task.module_key (0488): authority follows the record, not the screen
 * the code happens to live behind.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { AppError } = require("../../../utils/errors");
const identityCache = require("../../../shared/cache/identity-cache");
const { moduleKeyForDocType } = require("../../vault/document_vault/document_vault.types");
const controller = require("./template.controller");
const validator = require("./template.validator");

const M = "MOD-70";
const router = express.Router();
router.use(authMiddleware);

/**
 * Gate on the module that owns `:docType`, resolved per request.
 * `requirePermission` binds its module at mount time, which can't work here
 * because the module depends on the URL. Mirrors it otherwise, CEO bypass
 * included. A caller holding MOD-70 also passes — an administrator previewing
 * from the Studio shouldn't need every business module's grant.
 */
function requireDocTypePermission(action) {
  return async function docTypeRbac(req, _res, next) {
    if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    if (req.user.is_ceo) return next();

    const owning = moduleKeyForDocType(req.params.docType);
    const roleIds = req.user.role_ids || [];
    const column = action === "edit" ? "can_update" : "can_read";

    const allowed = await req.identityDb(async (c) => {
      for (const moduleKey of [owning, M]) {
         
        const grants = await identityCache.getGrants(c, { role_ids: roleIds, module: moduleKey });
        if (grants.some((g) => g[column] === true)) return true;
      }
      return false;
    });

    if (!allowed) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission to ${action === "edit" ? "generate" : "view"} ${req.params.docType} documents (needs ${owning})`,
        403,
      );
    }
    return next();
  };
}

// ── Studio: tenant configuration. Settings permission, unchanged. ────────────
router.get("/", requirePermission(M, "view"), controller.list);
router.get("/:docType/config", requirePermission(M, "view"), controller.getConfig);
router.put("/:docType/config", requirePermission(M, "edit"), validator.setConfig, controller.setConfig);

// ── Viewer: reading and producing a document of a given type. ────────────────
// `records` feeds the Studio's preview picker but also lists real records, so it
// follows the owning module too.
router.get("/:docType/records", requireDocTypePermission("view"), controller.records);
router.post("/:docType/preview", requireDocTypePermission("view"), validator.preview, controller.preview);
router.post("/:docType/generate", requireDocTypePermission("edit"), validator.preview, controller.generate);
router.post("/:docType/:id/send", requireDocTypePermission("edit"), validator.sendDoc, controller.send);

module.exports = { basePath: "/document-templates", feature: null, router };
