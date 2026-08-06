/** Document vault (MOD-64) — auth-gated reads + confidential download (not the
 *  public /media mount). SQL in the repo; gated per CONVENTIONS. */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission } = require("../../../middleware/rbac");
const { AppError } = require("../../../utils/errors");
const identityCache = require("../../../shared/cache/identity-cache");
const { moduleKeyForDocType } = require("./document_vault.types");
const controller = require("./document_vault.controller");
const service = require("./document_vault.service");
const validator = require("./document_vault.validator");

const MODULE = "MOD-64";
const router = express.Router();
router.use(authMiddleware);
/**
 * SEC-M3 — authority follows the RECORD, not the screen.
 *
 * `GET /:id` and `/:id/download` required MOD-64 `view` and nothing else. The
 * vault holds contracts, payslips, ID documents and signed PDFs across HR,
 * finance and operations, so anyone granted MOD-64 for any legitimate reason —
 * an operations clerk who needs to read shipping paperwork — could enumerate
 * and download **every document in the tenant, including HR files about their
 * colleagues**. The `field_visibility` layer masks FIELDS and has no document
 * analogue; the `/media` mount is correctly gated (`shared/http/media-guard.js`)
 * and the gap was always the granularity behind it, not the mount.
 *
 * This is the same principle `document-templates` already implements via
 * `moduleKeyForDocType` (template.routes.js) and `approval_task.module_key`
 * (0488): a payslip needs the payroll grant, a purchase request needs MOD-62.
 *
 * THE DIFFERENCE, and why this could not simply reuse that middleware: there
 * the doc type is in the URL, so the module is known before any I/O. Here it is
 * a column on the row, so the record must be loaded FIRST and the grant checked
 * against what it turns out to be. That ordering is the whole implementation.
 *
 * MOD-64 still passes, deliberately. It is the vault administrator's grant, and
 * revoking that in the same change would break the people whose job is the
 * vault itself — a silent lockout dressed as a security fix. The tightening
 * that matters is that MOD-64 is no longer the ONLY way in, and no longer a
 * skeleton key for departments a holder has no grant on.
 */
function requireDocumentPermission(action) {
  return async function documentRecordRbac(req, _res, next) {
    if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    if (req.user.is_ceo) return next();

    const doc = await req.tenantDb((c) => service.get(c, req.params.id));
    // Not found is the controller's answer to give, with its own shape. Let it
    // through rather than inventing a 404 here — and note this deliberately
    // does NOT leak existence through the authorisation path.
    if (!doc) return next();

    const owning = moduleKeyForDocType(doc.doc_type);
    const column = action === "edit" ? "can_update" : "can_read";
    const roleIds = req.user.role_ids || [];

    const allowed = await req.identityDb(async (c) => {
      for (const moduleKey of [owning, MODULE]) {
        // Sequential on purpose: two grants at most, and the first hit short-
        // circuits, so the common case is one cache read rather than two.
        const grants = await identityCache.getGrants(c, { role_ids: roleIds, module: moduleKey });
        if (grants.some((g) => g[column] === true)) return true;
      }
      return false;
    });

    if (!allowed) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission to read this document (${doc.doc_type || "untyped"} — needs ${owning})`,
        403,
      );
    }
    return next();
  };
}

router.get("/", requirePermission(MODULE, "view"), controller.list);
router.get("/:id", requirePermission(MODULE, "view"), requireDocumentPermission("view"), controller.get);
router.get("/:id/download", requirePermission(MODULE, "view"), requireDocumentPermission("view"), controller.download);
// Writes: upload a document (base64) and soft-delete (archive).
router.post("/", requirePermission(MODULE, "create"), validator.create, controller.create);
router.delete("/:id", requirePermission(MODULE, "delete"), controller.archive);

module.exports = { basePath: "/documents", feature: null, router };
