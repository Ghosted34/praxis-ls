/** Worker job: render a document to PDF, store it, capture it in the vault.
 *  Two shapes:
 *   - pre-built HTML:    { tenantMeta, env, html, key, entityRef, docType }
 *   - build-from-record: { tenantMeta, env, docType, recordId, entityId }  ← the
 *     Template Studio pipeline builds the HTML in-worker from the registry + the
 *     tenant's saved config, so a lifecycle event only enqueues a light job. */
"use strict";
const registry = require("../../services/tenant/registry.service");
const pdf = require("../../services/pdf.service");
module.exports = async function pdfRender(job) {
  const { tenantMeta, env = "live", html, key, entityRef, docType, recordId, entityId } = job.data || {};
  if (!tenantMeta) throw new Error("pdf job needs tenantMeta");
  if (docType && recordId && !html) {
    const templateSvc = require("../../modules/documents/template/template.service");
    return registry.withTenantConnection(tenantMeta, env, (c) => templateSvc.generate(c, { docType, recordId, entityId }));
  }
  if (!html || !entityRef) throw new Error("pdf job needs html + entityRef");
  return registry.withTenantConnection(tenantMeta, env, (c) => pdf.renderAndStore(c, { html, key, entityRef, docType }));
};
