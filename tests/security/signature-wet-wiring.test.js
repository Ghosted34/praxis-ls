"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

describe("wet-signature wiring", () => {
  test("barcode reads do not mark a job printed; printing is an explicit write route", () => {
    const routes = read("src/modules/vault/signature_wet/signature_wet.routes.js");
    const controller = read("src/modules/vault/signature_wet/signature_wet.controller.js");
    const service = read("src/modules/vault/signature_wet/signature_wet.service.js");

    expect(routes).toContain('router.get("/print-jobs/:id/barcode"');
    expect(routes).toContain('router.post("/print-jobs/:id/printed"');
    expect(controller).toContain("markPrinted");
    expect(service.match(/async function barcodeFor[\s\S]*?\n}/)[0]).not.toContain("markPrinted");
  });

  test("job transitions are guarded and terminal duplicate scans cannot update the job", () => {
    const repo = read("src/modules/vault/signature_wet/signature_wet.repo.js");
    const service = read("src/modules/vault/signature_wet/signature_wet.service.js");

    expect(repo).toContain("async function transitionJob(client, id, status, expected");
    expect(repo).toContain("AND status = ANY");
    expect(repo).toContain("scan_vault_id = COALESCE(scan_vault_id");
    expect(service).toContain('job && ["ISSUED", "PRINTED"].includes(job.status)');
  });

  test("reconciliation evidence, not mutable job status, is used to detect duplicate scans", () => {
    const repo = read("src/modules/vault/signature_wet/signature_wet.repo.js");
    const body = repo.match(/async function hasReconciledScan[\s\S]*?\n}/)[0];

    expect(body).toContain("signature_ingest");
    expect(body).toContain("document_signature");
    expect(body).not.toContain("status = 'RECONCILED'");
  });

  test("PRINT_SIGN is enabled only for doc types whose wet ceiling allows paper", () => {
    const migration = read("migrations/tenant/10792_signature_wet_policy.sql");

    expect(migration).toContain("DELIVERY_NOTE");
    expect(migration).toContain("TRANSIT_ORDER");
    expect(migration).not.toContain("EMPLOYMENT_CONTRACT'),");
    expect(migration).toContain("EMPLOYMENT_CONTRACT does not");
  });

  test("the rendered footer path is gated by the database feature flag", () => {
    const service = read("src/modules/documents/template/template.service.js");

    expect(service).toContain("async function wetPrintBlockFor");
    expect(service).toContain("feature_key = 'signatures.wet'");
    expect(service).toContain("openJobForEntity");
    expect(service).toContain("cfg.wet_print = await wetPrintBlockFor");
  });
});
