"use strict";
/**
 * Media-attachment outbox — the reconciliation and its guarantees
 * (PR-07, CE-11 + CE-25).
 *
 * ── WHAT THESE TESTS ARE ACTUALLY PROTECTING ───────────────────────────────
 *
 * Not "the sweep works" — that it is SAFE TO RE-RUN, and that the two
 * public-safety properties hold no matter what crashed:
 *
 *   CE-11  a document scan whose link PATCH never landed is COMPLETED from
 *          ground truth (the vault row's entity_ref names the row it was
 *          meant for), not from recorded state — and running the pass again
 *          does nothing, because a linked document no longer matches.
 *
 *   CE-25  a SITE_MEDIA object created before an owner-pointer commit that
 *          never came is archived and its bytes deleted — but ONLY once it
 *          is past the TTL, and NEVER while an owner column points at it:
 *          that check lives in the archiving UPDATE's WHERE clause, so a
 *          replacement committing mid-sweep wins the race.
 *
 * ── THE FAKE ────────────────────────────────────────────────────────────────
 *
 * A statement interpreter over an in-memory tenant: document_vault, the three
 * document tables, media_attachment, the four slot-owner tables. It answers
 * the ground-truth SELECTs from those rows and applies the guarded UPDATEs
 * with their WHERE clauses honoured — including the NOT EXISTS owner-pointer
 * guards, which is what makes the race test below a test of the SQL rather
 * than of a copy of its intent.
 *
 * SAVEPOINT outside a transaction throws, exactly as Postgres does (25P01) —
 * that is the probe atomically() uses to decide whether to open its own
 * BEGIN, and a fake that accepts it silently turns every transaction into a
 * no-op (a lesson learned the hard way in this file's first draft).
 */
const outbox = require("../../src/modules/vault/document_vault/attachment_outbox.service");
const variants = require("../../src/modules/vault/document_vault/attachment_variants");
const imagePipeline = require("../../src/services/image-pipeline.service");
const businessMetrics = require("../../src/shared/observability/business-metrics");

jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn(async () => ({ key: "stored" })),
  delete: jest.fn(async () => {}),
}));

const storage = require("../../src/services/storage.service");

const DOC_TABLES = {
  entity_document: "entityDocs",
  client_document: "clientDocs",
  supplier_document: "supplierDocs",
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** A tenant-shaped in-memory database with the guards the sweep relies on. */
function makeTenantDb() {
  const db = {
    vault: new Map(), // doc_id -> row
    entityDocs: new Map(),
    clientDocs: new Map(),
    supplierDocs: new Map(),
    attachments: new Map(), // attachment_id -> row
    corporateEntities: new Map(),
    siteLeaders: new Map(),
    sitePartners: new Map(),
    siteCredentials: new Map(),
    audits: [],
  };
  db.nextId = 0;

  const ownerPointsAt = (docId) =>
    [...db.corporateEntities.values()].some((o) => o.public_cover_vault_id === docId) ||
    [...db.siteLeaders.values()].some((o) => o.photo_vault_id === docId) ||
    [...db.sitePartners.values()].some((o) => o.logo_vault_id === docId) ||
    [...db.siteCredentials.values()].some((o) => o.logo_vault_id === docId);

  const ttlSeconds = (interval) => Number(String(interval).match(/\d+/)[0]);

  const liveAttachmentsFor = (docId) =>
    [...db.attachments.values()].filter(
      (a) =>
        a.vault_doc_id === docId &&
        a.kind === "DOCUMENT_SCAN" &&
        ["INTENT", "BYTES_STORED", "FAILED"].includes(a.state),
    );

  async function query(text, params = []) {
    const q = String(text).trim();

    if (q.startsWith("RELEASE")) return { rows: [], rowCount: 0 };
    if (q.startsWith("SAVEPOINT")) {
      // 25P01 outside a transaction — see the header.
      if (!db.inTx) throw new Error("SAVEPOINT can only be used in transaction blocks");
      return { rows: [], rowCount: 0 };
    }
    if (q === "BEGIN") { db.inTx = true; return { rows: [], rowCount: 0 }; }
    if (q === "COMMIT") { db.inTx = false; return { rows: [], rowCount: 0 }; }
    if (q === "ROLLBACK") { db.inTx = false; return { rows: [], rowCount: 0 }; }

    // ── ground-truth reads ────────────────────────────────────────────────
    // Claimable scans: live bytes naming an unlinked document row. Anchored on
    // its ORDER BY (and media_attachment-free shape) because phase 2's
    // unclaimed query below shares the JOIN/d.vault_id IS NULL fragments once
    // its unlinked predicate spells out `d.vault_id IS NULL` explicitly.
    const claimable = q.match(
      /JOIN (entity_document|client_document|supplier_document) d ON d\.document_id::text = split_part/,
    );
    if (claimable && /d\.vault_id IS NULL/.test(q) && /ORDER BY v\.created_at DESC/.test(q)) {
      const table = claimable[1];
      const rows = [...db.vault.values()]
        .filter(
          (v) =>
            v.entity_ref &&
            v.entity_ref.startsWith(`${table}:`) &&
            v.status !== "ARCHIVED" &&
            !v.storage_path.startsWith("pending://"),
        )
        .filter((v) => {
          const doc = db[DOC_TABLES[table]].get(v.entity_ref.split(":")[1]);
          return doc && doc.vault_id == null; // eslint-disable-line eqeqeq
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((v) => ({
          doc_id: v.doc_id,
          entity_ref: v.entity_ref,
          storage_path: v.storage_path,
          created_at: v.created_at,
          owner_id: v.entity_ref.split(":")[1],
        }));
      return { rows, rowCount: rows.length };
    }

    // SITE_MEDIA orphans: unscoped, unarchived, past the TTL, unowned.
    if (/doc_type = 'SITE_MEDIA'/.test(q) && /v\.public_media_scope IS NULL/.test(q) && /^SELECT/.test(q)) {
      const ttl = ttlSeconds(params[0]) * 1000;
      const rows = [...db.vault.values()].filter(
        (v) =>
          v.doc_type === "SITE_MEDIA" &&
          v.public_media_scope == null && // eslint-disable-line eqeqeq
          v.status !== "ARCHIVED" &&
          Date.now() - Date.parse(v.created_at) > ttl &&
          !ownerPointsAt(v.doc_id),
      );
      return { rows, rowCount: rows.length };
    }

    // Unclaimed document scans: never-linked attempts past the TTL whose
    // document row is gone or points elsewhere.
    if (/JOIN media_attachment a\s+ON a\.vault_doc_id = v\.doc_id/.test(q)) {
      const table = q.match(/LEFT JOIN (entity_document|client_document|supplier_document) d/)[1];
      const ttl = ttlSeconds(params[0]) * 1000;
      const seen = new Set();
      const rows = [...db.vault.values()]
        .filter(
          (v) =>
            v.entity_ref &&
            v.entity_ref.startsWith(`${table}:`) &&
            v.status !== "ARCHIVED" &&
            Date.now() - Date.parse(v.created_at) > ttl &&
            liveAttachmentsFor(v.doc_id).length > 0,
        )
        .filter((v) => {
          const doc = db[DOC_TABLES[table]].get(v.entity_ref.split(":")[1]);
          return !doc || doc.vault_id !== v.doc_id;
        })
        .filter((v) => (seen.has(v.doc_id) ? false : seen.add(v.doc_id)))
        .map((v) => ({
          doc_id: v.doc_id,
          entity_ref: v.entity_ref,
          storage_path: v.storage_path,
          created_at: v.created_at,
          owner_id: v.entity_ref.split(":")[1],
        }));
      return { rows, rowCount: rows.length };
    }

    // One vault row by id.
    if (/FROM document_vault WHERE doc_id = \$1/.test(q) && /^SELECT/.test(q)) {
      const row = db.vault.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    // The variant keys a SITE_MEDIA attempt recorded.
    if (/SELECT variant_keys\s+FROM media_attachment/.test(q)) {
      const rows = [...db.attachments.values()]
        .filter((a) => a.vault_doc_id === params[0] && a.kind === "SITE_MEDIA")
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return { rows: rows[0] ? [{ variant_keys: rows[0].variant_keys }] : [], rowCount: rows.length };
    }

    // Which of these document ids have bytes waiting under their entity_ref.
    if (/entity_ref = ANY\(\$1::text\[\]\)/.test(q)) {
      const refs = new Set(params[0]);
      const rows = [...db.vault.values()]
        .filter(
          (v) =>
            refs.has(v.entity_ref) &&
            v.status !== "ARCHIVED" &&
            !v.storage_path.startsWith("pending://"),
        )
        .map((v) => ({ owner_id: v.entity_ref.split(":")[1] }));
      const distinct = [...new Map(rows.map((r) => [r.owner_id, r])).values()];
      return { rows: distinct, rowCount: distinct.length };
    }

    // ── guarded writes ────────────────────────────────────────────────────
    // Phase 1: complete the link (re-asserts vault_id IS NULL).
    const heal = q.match(/^UPDATE (entity_document|client_document|supplier_document)\b/);
    if (heal && /vault_id = \$2/.test(q)) {
      const doc = db[DOC_TABLES[heal[1]]].get(params[0]);
      if (!doc || doc.vault_id != null) return { rows: [], rowCount: 0 }; // eslint-disable-line eqeqeq
      doc.vault_id = params[1];
      if (doc.scan_status === "PENDING") doc.scan_status = "SCANNED";
      return { rows: [doc], rowCount: 1 };
    }

    // Archive a SITE_MEDIA orphan — owner-pointer guards honoured.
    if (/UPDATE document_vault v\s+SET status = 'ARCHIVED'/.test(q) && /v\.public_media_scope IS NULL/.test(q)) {
      const row = db.vault.get(params[0]);
      // eslint-disable-next-line eqeqeq -- null and undefined both mean "unscoped"
      if (!row || row.status === "ARCHIVED" || row.public_media_scope != null || ownerPointsAt(row.doc_id)) {
        return { rows: [], rowCount: 0 };
      }
      row.status = "ARCHIVED";
      return { rows: [{ doc_id: row.doc_id, status: row.status }], rowCount: 1 };
    }

    // Archive a never-linked scan — outbox-intent + unclaimed guards honoured.
    if (/UPDATE document_vault v\s+SET status = 'ARCHIVED'/.test(q) && /media_attachment a/.test(q)) {
      const row = db.vault.get(params[0]);
      if (!row || row.status === "ARCHIVED" || liveAttachmentsFor(row.doc_id).length === 0) {
        return { rows: [], rowCount: 0 };
      }
      const claimed = Object.entries(DOC_TABLES).some(([table, key]) =>
        [...db[key].values()].some(
          (d) => d.vault_id === row.doc_id && row.entity_ref === `${table}:${d.document_id}`,
        ),
      );
      if (claimed) return { rows: [], rowCount: 0 };
      row.status = "ARCHIVED";
      return { rows: [{ doc_id: row.doc_id, status: row.status }], rowCount: 1 };
    }

    // Close the outbox attempts a landed link resolves.
    if (/UPDATE media_attachment\s+SET state = \$4/.test(q)) {
      const rows = [...db.attachments.values()]
        .filter(
          (a) =>
            a.kind === "DOCUMENT_SCAN" &&
            a.owner_table === params[0] &&
            a.owner_id === params[1] &&
            a.vault_doc_id === params[2] &&
            !["LINKED", "RECONCILED"].includes(a.state),
        )
        .map((a) => ((a.state = params[3]), { attachment_id: a.attachment_id }));
      return { rows, rowCount: rows.length };
    }

    // Close attempts whose vault row is archived or gone.
    if (/UPDATE media_attachment a\s+SET state = 'RECONCILED'/.test(q)) {
      let n = 0;
      for (const a of db.attachments.values()) {
        if (["INTENT", "BYTES_STORED", "FAILED"].includes(a.state) && a.vault_doc_id) {
          const v = db.vault.get(a.vault_doc_id);
          if (!v || v.status === "ARCHIVED") { a.state = "RECONCILED"; n += 1; }
        }
      }
      return { rows: [], rowCount: n };
    }

    // Close stale INTENTs with nothing behind them.
    if (/WHERE state = 'INTENT'/.test(q)) {
      const ttl = ttlSeconds(params[0]) * 1000;
      let n = 0;
      for (const a of db.attachments.values()) {
        if (
          a.state === "INTENT" &&
          !a.vault_doc_id &&
          Date.now() - Date.parse(a.created_at) > ttl
        ) { a.state = "RECONCILED"; n += 1; }
      }
      return { rows: [], rowCount: n };
    }

    // The audit ledger (params: [actor, role, name, email, action, module, entityRef, ...]).
    if (/INSERT INTO immutable_ledger/.test(q)) {
      db.audits.push({ action: params[4], entityRef: params[6] });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`makeTenantDb: unrecognised statement: ${q.slice(0, 100)}`);
  }

  return { db, client: { query } };
}

/* ── seeding helpers ───────────────────────────────────────────────────────*/

function seedDoc(tenant, table, { id, vaultId = null, scanStatus = "PENDING" }) {
  tenant.db[DOC_TABLES[table]].set(id, { document_id: id, vault_id: vaultId, scan_status: scanStatus });
}
function seedVault(tenant, row) {
  tenant.db.vault.set(row.doc_id, {
    status: "VERIFIED",
    public_media_scope: null,
    created_at: daysAgo(0),
    ...row,
  });
}
function seedAttachment(tenant, row) {
  const id = row.attachment_id || `att-${++tenant.db.nextId}`;
  tenant.db.attachments.set(id, {
    kind: "SITE_MEDIA",
    state: "BYTES_STORED",
    attempts: 0,
    variant_keys: [],
    created_at: daysAgo(0),
    ...row,
    attachment_id: id,
  });
  return tenant.db.attachments.get(id);
}

const deletedKeys = () => storage.delete.mock.calls.map((c) => c[0]);

/* ── CE-11: completing the links ───────────────────────────────────────────*/

describe("the reconciliation — document scans (CE-11)", () => {
  test("completes a link whose PATCH never landed, from ground truth", async () => {
    const t = makeTenantDb();
    seedDoc(t, "entity_document", { id: "ED-1" });
    seedVault(t, { doc_id: "V-1", entity_ref: "entity_document:ED-1", storage_path: "t/vault/v1.png" });
    seedAttachment(t, { kind: "DOCUMENT_SCAN", owner_table: "entity_document", owner_id: "ED-1", vault_doc_id: "V-1" });

    const out = await outbox.reconcile(t.client);

    expect(out.linked).toBe(1);
    expect(t.db.entityDocs.get("ED-1")).toMatchObject({ vault_id: "V-1", scan_status: "SCANNED" });
    // The exact scan-bump semantics of the PATCH the operator was owed.
    expect(t.db.attachments.get("att-1").state).toBe("LINKED");
    expect(t.db.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "media_reconciliation.document_scan_linked", entityRef: "entity_document:ED-1" }),
      ]),
    );

    // SAFE TO RE-RUN: a linked document no longer matches, so the second pass
    // links nothing, audits nothing and deletes nothing.
    const auditsAfterFirst = t.db.audits.length;
    const again = await outbox.reconcile(t.client);
    expect(again.linked).toBe(0);
    expect(again.swept).toBe(0);
    expect(t.db.audits.length).toBe(auditsAfterFirst);
  });

  test("heals scans that predate the outbox entirely — entity_ref is the truth", async () => {
    const t = makeTenantDb();
    seedDoc(t, "client_document", { id: "CD-1" });
    seedVault(t, { doc_id: "V-9", entity_ref: "client_document:CD-1", storage_path: "t/vault/v9.png" });
    // No attachment row at all — the damage is older than this feature.

    const out = await outbox.reconcile(t.client);
    expect(out.linked).toBe(1);
    expect(t.db.clientDocs.get("CD-1").vault_id).toBe("V-9");
  });

  test("latest attempt wins; the superseded never-linked bytes are swept after the TTL", async () => {
    const t = makeTenantDb();
    seedDoc(t, "entity_document", { id: "ED-2" });
    seedVault(t, {
      doc_id: "V-OLD", entity_ref: "entity_document:ED-2",
      storage_path: "t/vault/old.png", created_at: daysAgo(3),
    });
    seedVault(t, { doc_id: "V-NEW", entity_ref: "entity_document:ED-2", storage_path: "t/vault/new.png" });
    const aOld = seedAttachment(t, {
      kind: "DOCUMENT_SCAN", owner_table: "entity_document", owner_id: "ED-2",
      vault_doc_id: "V-OLD", created_at: daysAgo(3),
    });
    const aNew = seedAttachment(t, {
      kind: "DOCUMENT_SCAN", owner_table: "entity_document", owner_id: "ED-2", vault_doc_id: "V-NEW",
    });

    await outbox.reconcile(t.client);

    // The newest upload is the one the operator meant.
    expect(t.db.entityDocs.get("ED-2").vault_id).toBe("V-NEW");
    expect(aNew.state).toBe("LINKED");
    // The older attempt never landed and never will: archived, bytes deleted,
    // bookkeeping closed. "The vault object is not orphaned" — CE-11.
    expect(t.db.vault.get("V-OLD").status).toBe("ARCHIVED");
    expect(deletedKeys()).toEqual(expect.arrayContaining(["t/vault/old.png"]));
    expect(aOld.state).toBe("RECONCILED");

    const again = await outbox.reconcile(t.client);
    expect(again).toMatchObject({ linked: 0, swept: 0 });
  });
});

/* ── CE-25: sweeping the media orphans ─────────────────────────────────────*/

describe("the reconciliation — SITE_MEDIA orphans (CE-25)", () => {
  function seededTenant() {
    const t = makeTenantDb();
    t.db.corporateEntities.set("E-1", { entity_id: "E-1", public_cover_vault_id: "V-LIVE" });
    seedVault(t, {
      doc_id: "V-LIVE", doc_type: "SITE_MEDIA", public_media_scope: "SITE",
      entity_ref: "corporate_entity:E-1", storage_path: "t/vault/live.png",
    });
    return t;
  }

  test("archives an aged orphan and deletes every key it wrote", async () => {
    const t = seededTenant();
    seedVault(t, {
      doc_id: "V-ORPH", doc_type: "SITE_MEDIA", public_media_scope: null,
      entity_ref: "corporate_entity:E-1", storage_path: "t/vault/orph.png",
      created_at: daysAgo(2),
    });
    const a = seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "corporate_entity", owner_id: "E-1", slot: "entity-cover",
      vault_doc_id: "V-ORPH", state: "FAILED", last_error: "boom",
      variant_keys: ["t/vault/orph@480.avif"], created_at: daysAgo(2),
    });

    const out = await outbox.reconcile(t.client);

    expect(out.swept).toBe(1);
    expect(t.db.vault.get("V-ORPH").status).toBe("ARCHIVED");
    // The master, the pipeline derivatives the vault wrote at creation, the
    // recorded site-ladder keys, and the full candidate ladder (ENOENT for
    // the ones never written is tolerated by design).
    const keys = deletedKeys();
    expect(keys).toContain("t/vault/orph.png");
    expect(keys).toContain(imagePipeline.derivativeKey("t/vault/orph.png", "thumb", "avif"));
    expect(keys).toContain(imagePipeline.derivativeKey("t/vault/orph.png", "preview", "webp"));
    expect(keys).toContain("t/vault/orph@480.avif");
    expect(keys).toContain(variants.variantKey("t/vault/orph.png", 960, "webp"));
    // The live cover is untouched, and the failed attempt is closed.
    expect(t.db.vault.get("V-LIVE").status).toBe("VERIFIED");
    expect(t.db.corporateEntities.get("E-1").public_cover_vault_id).toBe("V-LIVE");
    expect(a.state).toBe("RECONCILED");

    // SAFE TO RE-RUN: archived rows no longer match.
    const again = await outbox.reconcile(t.client);
    expect(again.swept).toBe(0);
    const deletionsAfterFirst = storage.delete.mock.calls.length;
    await outbox.reconcile(t.client);
    expect(storage.delete.mock.calls.length).toBe(deletionsAfterFirst);
  });

  test("a fresh orphan is left alone — the TTL is what tells a dead upload from one in flight", async () => {
    const t = seededTenant();
    seedVault(t, {
      doc_id: "V-FRESH", doc_type: "SITE_MEDIA", public_media_scope: null,
      entity_ref: "corporate_entity:E-1", storage_path: "t/vault/fresh.png",
    });
    seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "corporate_entity", owner_id: "E-1",
      vault_doc_id: "V-FRESH", state: "FAILED",
    });

    const out = await outbox.reconcile(t.client);
    expect(out.swept).toBe(0);
    expect(t.db.vault.get("V-FRESH").status).toBe("VERIFIED");
    expect(deletedKeys()).toEqual([]);
  });

  test("an object an owner points at is never swept — the guard is in the archive's WHERE", async () => {
    const t = seededTenant();
    // The pointer transaction for V-LATE committed between the sweep's SELECT
    // and its archive: the owner column now names the "orphan".
    seedVault(t, {
      doc_id: "V-LATE", doc_type: "SITE_MEDIA", public_media_scope: "SITE",
      entity_ref: "corporate_entity:E-1", storage_path: "t/vault/late.png",
      created_at: daysAgo(3),
    });
    t.db.corporateEntities.get("E-1").public_cover_vault_id = "V-LATE";
    seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "corporate_entity", owner_id: "E-1",
      vault_doc_id: "V-LATE", state: "BYTES_STORED", created_at: daysAgo(3),
    });

    const out = await outbox.reconcile(t.client);
    expect(out.swept).toBe(0);
    expect(t.db.vault.get("V-LATE").status).toBe("VERIFIED");
    expect(deletedKeys()).toEqual([]);
  });

  test("a FAILED attempt whose bytes are still live stays visible for retry", async () => {
    const t = seededTenant();
    // The bytes are the LIVE cover — a replacement attempt that pointed at
    // the still-serving document. Nothing to sweep, nothing to close: the
    // Story tab keeps the failure on screen until a real resolution.
    const a = seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "corporate_entity", owner_id: "E-1",
      vault_doc_id: "V-LIVE", state: "FAILED", created_at: daysAgo(5),
    });
    await outbox.reconcile(t.client);
    expect(a.state).toBe("FAILED");
  });

  test("an INTENT with nothing behind it is closed once it outlives the TTL", async () => {
    const t = makeTenantDb();
    const stale = seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "site_leader", owner_id: "L-1",
      state: "INTENT", vault_doc_id: null, created_at: daysAgo(3),
    });
    const fresh = seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "site_leader", owner_id: "L-2",
      state: "INTENT", vault_doc_id: null,
    });
    await outbox.reconcile(t.client);
    expect(stale.state).toBe("RECONCILED");
    expect(fresh.state).toBe("INTENT");
  });
});

/* ── the register's view of the in-between state ───────────────────────────*/

describe("annotateUnlinkedScans — the 'file stored, link pending' flag", () => {
  test("flags exactly the rows whose bytes wait under an unlinked entity_ref", async () => {
    const t = makeTenantDb();
    seedDoc(t, "entity_document", { id: "ED-WAIT" });   // bytes waiting, link missing
    seedDoc(t, "entity_document", { id: "ED-EMPTY" });  // paper-only, nothing stored
    seedDoc(t, "entity_document", { id: "ED-LINKED", vaultId: "V-OK", scanStatus: "SCANNED" });
    seedVault(t, { doc_id: "V-WAIT", entity_ref: "entity_document:ED-WAIT", storage_path: "t/vault/wait.png" });
    seedVault(t, { doc_id: "V-OK", entity_ref: "entity_document:ED-LINKED", storage_path: "t/vault/ok.png" });

    const rows = await outbox.annotateUnlinkedScans(t.client, "entity_document", [
      { document_id: "ED-WAIT", vault_id: null },
      { document_id: "ED-EMPTY", vault_id: null },
      { document_id: "ED-LINKED", vault_id: "V-OK" },
    ]);

    expect(rows.find((r) => r.document_id === "ED-WAIT").scan_stored_unlinked).toBe(true);
    expect(rows.find((r) => r.document_id === "ED-EMPTY").scan_stored_unlinked).toBeUndefined();
    // A linked row is not waiting, even though a superseded file still sits
    // in the vault under the same entity_ref.
    expect(rows.find((r) => r.document_id === "ED-LINKED").scan_stored_unlinked).toBeUndefined();
  });
});

/* ── the metrics — orphans must be measurable ──────────────────────────────*/

describe("the reconciliation counters (PR-10 / B.2)", () => {
  const metrics = require("../../src/shared/observability/metrics");

  afterEach(() => metrics.__reset());

  test("every reconcile outcome increments its counter, and a no-op pass increments nothing", async () => {
    metrics.__reset();
    // One pass over the full damage catalogue: a link to complete, an orphan
    // to sweep (whose bytes go with it), and stale intents to close.
    const t = makeTenantDb();
    seedDoc(t, "entity_document", { id: "ED-M" });
    seedVault(t, {
      doc_id: "V-LINK", entity_ref: "entity_document:ED-M",
      storage_path: "t/vault/link.png",
    });
    seedAttachment(t, {
      kind: "DOCUMENT_SCAN", owner_table: "entity_document", owner_id: "ED-M",
      vault_doc_id: "V-LINK",
    });
    seedVault(t, {
      doc_id: "V-ORPHAN", doc_type: "SITE_MEDIA", entity_ref: null,
      storage_path: "t/vault/orphan.png", created_at: daysAgo(3),
    });
    // The attempt that parked those bytes: FAILED, pointing at the vault row
    // the sweep is about to archive — exactly what phase 3 then closes.
    seedAttachment(t, {
      kind: "SITE_MEDIA", owner_table: "corporate_entity", owner_id: "E-M",
      slot: "entity-cover", vault_doc_id: "V-ORPHAN", state: "FAILED",
      last_error: "boom", created_at: daysAgo(3),
    });

    const out = await outbox.reconcile(t.client);

    expect(out.linked).toBe(1);
    expect(out.swept).toBe(1);
    expect(out.bytes_deleted).toBeGreaterThan(0);
    const counters = metrics.snapshot().counters["praxis_media_reconciliation_total"];
    expect(counters).toMatchObject({
      "result=linked": 1,
      "result=swept": 1,
      "result=bytes_deleted": out.bytes_deleted,
    });
    // Bookkeeping was closed too — the exact count is the repo's business;
    // the counter's business is that it is present and non-zero.
    expect(Number(counters["result=outbox_closed"])).toBeGreaterThan(0);

    // A pass with nothing to do moves no counter: a flat line after activity
    // is the healthy reading, and this is what makes that readable.
    metrics.__reset();
    const again = await outbox.reconcile(t.client);
    expect(again).toMatchObject({ linked: 0, swept: 0, bytes_deleted: 0 });
    expect(metrics.snapshot().counters["praxis_media_reconciliation_total"]).toBeUndefined();
  });

  test("a storage delete that fails (not ENOENT) counts as a byte_failure", async () => {
    metrics.__reset();
    storage.delete.mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
    const t = makeTenantDb();
    seedVault(t, {
      doc_id: "V-F", doc_type: "SITE_MEDIA", entity_ref: null,
      storage_path: "t/vault/f.png", created_at: daysAgo(3),
    });

    const out = await outbox.reconcile(t.client);

    expect(out.byte_failures).toBeGreaterThan(0);
    expect(metrics.snapshot().counters["praxis_media_reconciliation_total"]).toMatchObject({
      "result=byte_failures": out.byte_failures,
    });
  });
});

describe("the business-metrics probes (PR-07)", () => {
  test("the orphan and unlinked-media gauges exist and read the tables that hold the truth", () => {
    const gauges = new Map(businessMetrics.PROBES.map((p) => [p.gauge, p]));
    const attachment = gauges.get("praxis_media_attachment_open");
    const unlinked = gauges.get("praxis_vault_unlinked_document_scans");
    const orphan = gauges.get("praxis_vault_orphan_site_media");

    expect(attachment).toBeDefined();
    expect(attachment.sql).toContain("FROM media_attachment");
    expect(attachment.sql).toContain("'FAILED'");
    expect(attachment.labels({ kind: "SITE_MEDIA", state: "FAILED" })).toEqual({
      kind: "SITE_MEDIA",
      state: "FAILED",
    });

    expect(unlinked).toBeDefined();
    // Reads ground truth (document_vault.entity_ref vs the document tables),
    // not the outbox — so it counts damage that predates the feature too.
    expect(unlinked.sql).toContain("FROM document_vault v");
    expect(unlinked.sql).toContain("entity_document");
    expect(unlinked.sql).toContain("d.vault_id IS NULL");

    expect(orphan).toBeDefined();
    expect(orphan.sql).toContain("doc_type = 'SITE_MEDIA'");
    expect(orphan.sql).toContain("public_media_scope IS NULL");
    expect(orphan.sql).toContain("public_cover_vault_id");
  });
});
