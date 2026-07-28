/** Worker job: render a document to PDF, store it, capture it in the vault.
 *  Two shapes:
 *   - pre-built HTML: { tenantMeta, env, html, key, entityRef, docType }
 *   - template-driven (GAP_FIXES_PLAN §5.1): { tenantMeta, env, docType, data,
 *     key, entityRef } — resolves the tenant's document_template for docType. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const pdf = require("../../services/pdf.service");
module.exports = async function pdfRender(job) {
  const { tenantMeta, env = "live", html, data, key, entityRef, docType } = job.data || {};
  if (!tenantMeta || !entityRef) throw new Error("pdf job needs tenantMeta + entityRef");
  if (!html && !docType) throw new Error("pdf job needs html, or docType for a template render");
  return registry.withTenantConnection(tenantMeta, env, (c) =>
    html
      ? pdf.renderAndStore(c, { html, key, entityRef, docType })
      : pdf.renderDocType(c, { docType, data, key, entityRef }));
};
