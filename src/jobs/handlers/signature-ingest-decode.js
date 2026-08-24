/** Worker job: decode and reconcile one wet-signature ingest row. */
"use strict";

const registry = require("../../services/tenant/registry.service");

module.exports = async function signatureIngestDecode(job) {
  const { tenantMeta, env = "live", ingestId, actor = null } = job.data || {};
  if (!tenantMeta) throw new Error("signature-ingest-decode needs tenantMeta");
  if (!ingestId) throw new Error("signature-ingest-decode needs ingestId");

  return registry.withTenantConnection(tenantMeta, env, async (client) => {
    const service = require("../../modules/vault/signature_wet/signature_wet.service");
    return service.decodeAndReconcile(client, { ingestId, actor: actor || {} });
  });
};
