"use strict";

/**
 * PR 3 of the tenant review of 21 Sep 2026 ("meeting 5"), against a real
 * schema: every new query runs, so a column typo is a test failure rather than
 * a 500 on the first click.
 *
 *   - the treasury list's renewal count, and a document linked to its scan;
 *   - the letterhead's address columns (14140) round-trip through the repo;
 *   - the portal's invoice read and the operations search by service type.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise, like every suite in this directory.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("meeting 5 — PR 3 queries", () => {
  let pool;
  let c;
  const cleanup = [];

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    for (const [sql, params] of cleanup.reverse()) await c.query(sql, params).catch(() => {});
    c.release();
    await pool.end();
  });

  test("treasury: the list counts documents to renew, and a scan links", async () => {
    const repo = require("../../src/modules/master/treasury_account/treasury_account.repo");
    const service = require("../../src/modules/master/treasury_account/treasury_account.service");
    const rows = await repo.list(c, { limit: 5 });
    for (const r of rows) expect(typeof r.docs_expiring).toBe("number");
    const acc = rows[0];
    if (!acc) return; // a tenant with no treasury account has nothing to attach to

    const doc = await service.addDocument(c, {
      accountId: acc.treasury_account_id, document_type: "BANK_RIB", title: "PR3 RIB",
      expiry_date: "2000-01-01", actor: {},
    });
    cleanup.push(["DELETE FROM treasury_account_document WHERE document_id = $1", [doc.document_id]]);
    const { rows: [v] } = await c.query(
      `INSERT INTO document_vault (doc_type, storage_path, entity_ref, original_name)
       VALUES ('TREASURY_DOCUMENT', 'test://pr3', $1, 'rib.pdf') RETURNING doc_id`,
      [`treasury_account_document:${doc.document_id}`],
    );
    cleanup.push(["DELETE FROM document_vault WHERE doc_id = $1", [v.doc_id]]);
    const linked = await service.attachDocumentScan(c, {
      accountId: acc.treasury_account_id, documentId: doc.document_id, vault_id: v.doc_id, actor: {},
    });
    expect(linked.vault_id).toBe(v.doc_id);
    expect(linked.file_name).toBe("rib.pdf");

    const after = (await repo.list(c, { limit: 50 })).find((r) => r.treasury_account_id === acc.treasury_account_id);
    expect(after.docs_expiring).toBeGreaterThanOrEqual(1);
  });

  test("letterhead: the 14140 columns are writable and read back", async () => {
    const repo = require("../../src/modules/master/corporate_entity/corporate_entity.repo");
    const { rows: [e] } = await c.query("SELECT entity_id FROM corporate_entity LIMIT 1");
    if (!e) return;
    const before = await repo.getLetterhead(c, e.entity_id);
    const saved = await repo.upsertLetterhead(c, e.entity_id, { identifiers_inline: false, show_po_box: false, address_id: null });
    expect(saved.identifiers_inline).toBe(false);
    expect(saved.show_po_box).toBe(false);
    await repo.upsertLetterhead(c, e.entity_id, {
      identifiers_inline: before ? before.identifiers_inline : true,
      show_po_box: before ? before.show_po_box : true,
    });
  });

  test("portal invoice read and operations search by service type both run", async () => {
    const portalRepo = require("../../src/modules/portal/portal.repo");
    const out = await portalRepo.clientInvoiceWithLines(c, {
      clientId: "00000000-0000-4000-8000-000000000000", invoiceId: "00000000-0000-4000-8000-000000000000",
    });
    expect(out).toBeNull();
    const ops = require("../../src/modules/operations/operations_file/operations_file.repo");
    const found = await ops.list(c, { q: "import", limit: 5 });
    expect(Array.isArray(found)).toBe(true);
  });
});
