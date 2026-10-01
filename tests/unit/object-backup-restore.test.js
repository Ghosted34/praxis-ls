"use strict";

/**
 * WS-B2 — the object backup's two holes, closed.
 *
 *   1. COVERAGE. The enumeration read one table, `document_vault`. Chat media
 *      lives in `comms_media` and was therefore never copied offsite and never
 *      scanned — while the nightly sync reported success, because it did copy
 *      everything it knew about. These tests pin that the enumeration is
 *      driven by the SOURCE LIST, so adding an upload path without adding it
 *      to that list is the thing that fails, rather than the backup silently
 *      narrowing.
 *
 *   2. NO WAY BACK. Files were copied out and nothing copied them in. The
 *      restore is the half that makes the other half a backup rather than an
 *      assertion, and the properties worth pinning are the safety ones: do not
 *      overwrite a surviving file, do not write a copy that fails its hash,
 *      and be able to say what you WOULD do without doing it.
 *
 * Storage, the tenant database and the platform database are all mocked; the
 * subject is the orchestration, not S3.
 */

const crypto = require("crypto");

jest.mock("../../src/services/platform/db", () => ({
  query: jest.fn(async () => ({ rows: [{ backup_run_id: "run-1" }] })),
  opsQuery: jest.fn(async () => ({ rows: [{ backup_run_id: "run-1" }] })),
  close: jest.fn(),
}));
jest.mock("../../src/services/platform/backup-storage.service", () => ({
  putStream: jest.fn(),
  openStream: jest.fn(),
  exists: jest.fn(async () => false),
  stat: jest.fn(),
  currentDriver: jest.fn(async () => "local"),
}));
jest.mock("../../src/services/storage.service", () => ({
  get: jest.fn(),
  put: jest.fn(async () => ({})),
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: jest.fn(),
  listActiveTenants: jest.fn(),
}));
jest.mock("../../src/services/platform/backup.service", () => ({
  startRun: jest.fn(async () => "run-1"),
  finishRun: jest.fn(async () => {}),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const backupStore = require("../../src/services/platform/backup-storage.service");
const storage = require("../../src/services/storage.service");
const registry = require("../../src/services/tenant/registry.service");
const backup = require("../../src/services/platform/backup.service");
const objects = require("../../src/services/platform/object-backup.service");

const meta = { slug: "acme", tenant_id: "tid-acme", live_schema: "live" };

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * A tenant connection whose tables are described by `tables`:
 *   { document_vault: [rows…], comms_media: [rows…] }
 * A table absent from the object answers `to_regclass` with null, which is how
 * a tenant provisioned before a migration must behave — no rows, not a crash.
 */
function fakeTenantDb(tables) {
  registry.withTenantConnection.mockImplementation(async (_meta, _schema, fn) =>
    fn({
      query: async (sql, params) => {
        if (sql.includes("to_regclass")) {
          const name = params[0];
          return { rows: [{ t: tables[name] ? name : null }] };
        }
        const table = Object.keys(tables).find((t) => sql.includes(`FROM ${t}`));
        return { rows: (tables[table] || []).map((r) => ({ ...r, source: table })) };
      },
    }),
  );
}

/** The offsite store hands back these bytes for `objects/<path>`. */
function offsiteHas(map) {
  backupStore.openStream.mockImplementation(async (key) => {
    const path = key.replace(/^objects\//, "");
    if (!(path in map)) throw new Error(`no such key: ${key}`);
    const { Readable } = require("stream");
    return Readable.from([map[path]]);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("what counts as a tenant's objects", () => {
  test("chat media is enumerated, not only vault documents", async () => {
    fakeTenantDb({
      document_vault: [{ doc_id: "d1", storage_path: "vault/a.pdf", content_hash: "h1" }],
      comms_media: [{ doc_id: "m1", storage_path: "tenant_acme/chat/x.jpg", content_hash: null }],
    });

    const rows = await objects.tenantObjects(meta);

    // The regression: this used to return only the vault row, so every chat
    // image in the product was outside the backup with nothing reporting it.
    expect(rows.map((r) => r.storage_path)).toEqual([
      "vault/a.pdf",
      "tenant_acme/chat/x.jpg",
    ]);
  });

  test("a tenant without the newer table is enumerated, not failed", async () => {
    fakeTenantDb({
      document_vault: [{ doc_id: "d1", storage_path: "vault/a.pdf", content_hash: "h1" }],
    });

    const rows = await objects.tenantObjects(meta);

    expect(rows).toHaveLength(1);
  });

  test("every declared source names a table and an id column", () => {
    for (const src of objects.OBJECT_SOURCES) {
      expect(typeof src.table).toBe("string");
      expect(typeof src.idColumn).toBe("string");
    }
  });
});

describe("restoreTenantObjects", () => {
  test("restores what is missing and leaves what survived alone", async () => {
    const bytes = Buffer.from("the original document");
    fakeTenantDb({
      document_vault: [
        { doc_id: "gone", storage_path: "vault/gone.pdf", content_hash: sha256(bytes) },
        { doc_id: "kept", storage_path: "vault/kept.pdf", content_hash: "whatever" },
      ],
    });
    offsiteHas({ "vault/gone.pdf": bytes, "vault/kept.pdf": Buffer.from("older copy") });
    // Primary storage still has `kept`, and does not have `gone`.
    storage.get.mockImplementation(async (key) => {
      if (key === "vault/kept.pdf") return Buffer.from("current copy");
      throw new Error("not found");
    });

    const r = await objects.restoreTenantObjects(meta);

    expect(r.ok).toBe(true);
    expect(r.restored).toBe(1);
    expect(r.skipped).toBe(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
    // A surviving file is never replaced by an older offsite copy: that would
    // turn a partial loss into a larger one.
    expect(storage.put.mock.calls[0][1].key).toBe("vault/gone.pdf");
  });

  test("a hash mismatch is reported and NOT written over anything", async () => {
    fakeTenantDb({
      document_vault: [
        { doc_id: "bad", storage_path: "vault/bad.pdf", content_hash: sha256(Buffer.from("good")) },
      ],
    });
    offsiteHas({ "vault/bad.pdf": Buffer.from("corrupted in the bucket") });
    storage.get.mockRejectedValue(new Error("not found"));

    const r = await objects.restoreTenantObjects(meta);

    expect(storage.put).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.mismatched).toHaveLength(1);
    // Recorded as a FAILED run, because this is data loss discovered — the one
    // finding that must not live only in a log line.
    expect(backup.finishRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  test("an object missing from the offsite store is the headline finding", async () => {
    fakeTenantDb({
      document_vault: [{ doc_id: "x", storage_path: "vault/x.pdf", content_hash: "h" }],
    });
    offsiteHas({});
    storage.get.mockRejectedValue(new Error("not found"));

    const r = await objects.restoreTenantObjects(meta);

    expect(r.ok).toBe(false);
    expect(r.missing_offsite).toHaveLength(1);
    expect(r.missing_offsite[0].storage_path).toBe("vault/x.pdf");
  });

  test("a dry run reports what it would do and writes nothing", async () => {
    const bytes = Buffer.from("doc");
    fakeTenantDb({
      document_vault: [{ doc_id: "d", storage_path: "vault/d.pdf", content_hash: sha256(bytes) }],
    });
    offsiteHas({ "vault/d.pdf": bytes });
    storage.get.mockRejectedValue(new Error("not found"));

    const r = await objects.restoreTenantObjects(meta, { dryRun: true });

    expect(storage.put).not.toHaveBeenCalled();
    expect(r.dry_run).toBe(true);
    expect(r.restored).toBe(1); // "would restore"
    expect(r.ok).toBe(true);
  });

  test("an object with no recorded hash is restored but reported as unverified", async () => {
    const bytes = Buffer.from("chat image bytes");
    fakeTenantDb({
      comms_media: [
        { doc_id: "m1", storage_path: "tenant_acme/chat/x.jpg", content_hash: null, content_type: "image/jpeg" },
      ],
    });
    offsiteHas({ "tenant_acme/chat/x.jpg": bytes });
    storage.get.mockRejectedValue(new Error("not found"));

    const r = await objects.restoreTenantObjects(meta);

    expect(r.restored).toBe(1);
    expect(r.unverified).toBe(1);
    expect(storage.put.mock.calls[0][1].contentType).toBe("image/jpeg");
  });

  test("--doc restores only the documents named", async () => {
    const a = Buffer.from("a");
    const b = Buffer.from("b");
    fakeTenantDb({
      document_vault: [
        { doc_id: "a", storage_path: "vault/a.pdf", content_hash: sha256(a) },
        { doc_id: "b", storage_path: "vault/b.pdf", content_hash: sha256(b) },
      ],
    });
    offsiteHas({ "vault/a.pdf": a, "vault/b.pdf": b });
    storage.get.mockRejectedValue(new Error("not found"));

    const r = await objects.restoreTenantObjects(meta, { docIds: ["b"] });

    expect(r.restored).toBe(1);
    expect(storage.put.mock.calls[0][1].key).toBe("vault/b.pdf");
  });
});
