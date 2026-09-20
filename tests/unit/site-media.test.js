/**
 * Website media — the upload control's server half (guide §6.3, O-10).
 *
 * ── WHAT THESE TESTS ARE ACTUALLY PROTECTING ───────────────────────────────
 *
 * Three rules, and none of them is about whether an upload works:
 *
 *   §1.3   a generated image may not occupy a slot a visitor reads as
 *          evidence. The migration (13789) makes it impossible at the row; this
 *          proves the SERVICE refuses it first, with the reason in the message,
 *          because "violates check constraint" is not something to show a
 *          marketing administrator.
 *   §9.4   a mark with a baked-in white background does not render. O-3 says
 *          the supplied logos are exactly that. `stats.isOpaque` is the test a
 *          note in a document cannot perform.
 *   §9.7   every partner rendered has a permission note — asserted, not
 *          inspected.
 *
 * ── AND ONE ABOUT PATHS ────────────────────────────────────────────────────
 *
 * `resolveVariant` is the only thing standing between a URL segment and a
 * storage key. It is tested for what it REFUSES, not for what it returns.
 */
"use strict";

// Hoisted with the file. The factories close over nothing out-of-scope — the
// new doc id lives inside the vault factory and is read back below, because a
// factory referencing a later-declared const would hit the temporal dead zone
// when the require above first executes it.
jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn(async () => ({ key: "stored" })),
  delete: jest.fn(async () => {}),
}));

jest.mock(
  "../../src/modules/vault/document_vault/document_vault.service",
  () => {
    // The bytes-and-row half is the vault's own, tested there. What the
    // upload-lifecycle tests below exercise is everything AFTER
    // createDocument returns.
    const docId = "22222222-2222-2222-2222-222222222222";
    return {
      __mockNewDocId: docId,
      createDocument: jest.fn(async () => ({
        doc_id: docId,
        storage_path: "tenant_t/vault/doc_new.png",
        status: "VERIFIED",
      })),
    };
  },
);

const media = require("../../src/modules/site/site_settings/site_settings.media");
const { siteSettings } = require("@praxis/shared");
const mockNewDocId =
  require("../../src/modules/vault/document_vault/document_vault.service").__mockNewDocId;

/*
 * ── the attachment outbox around an upload (PR-07, CE-25) ──────────────────
 *
 * These tests drive `upload()` end to end with the vault service and storage
 * mocked, against a client that ACTUALLY TRANSACTIONS: statements inside the
 * atomically() block are buffered and applied on COMMIT, discarded on
 * ROLLBACK — because the property being proven is precisely about what
 * survives a failed pointer transaction.
 *
 * The three rules, in the audit's own words:
 *
 *   · a FAILED cover replacement leaves the previous cover servable;
 *   · a failed new upload is not publishable;
 *   · every failure state names whether the record, the bytes and the link
 *     exist — here, in the outbox row the failed attempt leaves behind.
 */

/** A 1×1 PNG — the smallest buffer sharp will actually decode. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const OLD_DOC = "11111111-1111-1111-1111-111111111111";
const ENTITY = "33333333-3333-3333-3333-333333333333";

/**
 * A client that interprets the statements upload() actually issues, with
 * real transaction buffering. `failOn` names a SQL substring that throws the
 * first time it is reached — the injected fault is always the owner-pointer
 * UPDATE, the statement whose failure used to strand the bytes.
 */
function makeUploadClient({ priorCoverId = null, failOn = null } = {}) {
  const state = {
    ownerPointer: priorCoverId,
    // A prior cover was uploaded through the same path in an earlier request:
    // scoped public, pointed at, never archived. That is the "previous cover"
    // the public-safety property is about.
    scopes: priorCoverId ? { [priorCoverId]: "SITE" } : {},
    archived: [],      // doc_ids archived by a committed replacement
    outbox: [],        // media_attachment rows (autocommit + buffered updates)
    audits: [],
    inTx: false,
    txBuffer: [],
  };

  const record = (entry) => {
    if (state.inTx) state.txBuffer.push(entry);
    else applyEntry(entry);
  };
  const applyEntry = (entry) => {
    if (entry.kind === "scope") state.scopes[entry.docId] = "SITE";
    if (entry.kind === "pointer") state.ownerPointer = entry.docId;
    if (entry.kind === "archive") state.archived.push(entry.docId);
    if (entry.kind === "audit") state.audits.push(entry);
    if (entry.kind === "outbox") {
      const row = state.outbox.find((r) => r.attachment_id === entry.id);
      if (row) Object.assign(row, entry.sets);
    }
  };

  const client = {
    async query(text, params = []) {
      const q = String(text).trim();
      if (q.startsWith("RELEASE")) return { rows: [], rowCount: 0 };
      // Postgres raises 25P01 for a SAVEPOINT outside a transaction block —
      // this is the probe atomically() uses to detect a foreign BEGIN, and a
      // fake that accepts it makes every transaction a no-op.
      if (q.startsWith("SAVEPOINT")) {
        if (!state.inTx) throw new Error("SAVEPOINT can only be used in transaction blocks");
        return { rows: [], rowCount: 0 };
      }
      if (q === "BEGIN") { state.inTx = true; state.txBuffer = []; return { rows: [], rowCount: 0 }; }
      if (q === "COMMIT") {
        state.inTx = false;
        for (const entry of state.txBuffer) applyEntry(entry);
        state.txBuffer = [];
        return { rows: [], rowCount: 0 };
      }
      if (q === "ROLLBACK") { state.inTx = false; state.txBuffer = []; return { rows: [], rowCount: 0 }; }

      if (failOn && q.includes(failOn)) throw new Error("boom (injected)");

      // The owner read: which document the slot points at today. The
      // pointer transaction's FOR UPDATE re-read (PR-10 / B.4) can be made
      // to answer differently — that is how a concurrent replacement is
      // simulated without a second client.
      if (/SELECT public_cover_vault_id AS vault_id FROM corporate_entity/.test(q)) {
        const id = /FOR UPDATE/.test(q) && state.pointerAtLock !== undefined
          ? state.pointerAtLock
          : state.ownerPointer;
        return { rows: [{ vault_id: id }], rowCount: 1 };
      }
      // Where the vault put the new bytes.
      if (/SELECT storage_path FROM document_vault WHERE doc_id/.test(q)) {
        return { rows: [{ storage_path: "tenant_t/vault/doc_new.png" }], rowCount: 1 };
      }
      // The outbox INSERT (insertOne: quoted columns, positional params).
      if (/INSERT INTO media_attachment/.test(q)) {
        const cols = q
          .match(/\(([^()]+)\) VALUES/i)[1]
          .split(",")
          .map((s) => s.trim().replace(/"/g, ""));
        const row = { attachment_id: "att-1" };
        cols.forEach((c, i) => { row[c] = params[i]; });
        state.outbox.push(row);
        return { rows: [row], rowCount: 1 };
      }
      // An outbox state transition.
      if (/UPDATE media_attachment SET/.test(q)) {
        const id = params[params.length - 1];
        const sets = {};
        const setSql = q.slice(q.indexOf("SET") + 3, q.indexOf("WHERE"));
        for (const m of setSql.matchAll(/([a-z_]+) = \$(\d+)/g)) {
          sets[m[1]] = params[Number(m[2]) - 1];
        }
        if (/attempts = attempts \+ 1/.test(setSql)) sets.attempts = "bump";
        record({ kind: "outbox", id, sets });
        const row = state.outbox.find((r) => r.attachment_id === id);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // The audit ledger write (params: [actor, role, name, email, action, ...]).
      if (/INSERT INTO immutable_ledger/.test(q)) {
        record({ kind: "audit", action: params[4], entityRef: params[6] });
        return { rows: [], rowCount: 1 };
      }
      // The scope UPDATE — the statement that makes bytes publicly servable.
      if (/UPDATE document_vault\s+SET public_media_scope/.test(q)) {
        record({ kind: "scope", docId: params[0] });
        return { rows: [], rowCount: 1 };
      }
      // The owner pointer — the statement whose failure CE-25 is about.
      if (/UPDATE corporate_entity\s+SET public_cover_vault_id/.test(q)) {
        record({ kind: "pointer", docId: params[1] });
        return { rows: [{ public_cover_vault_id: params[1] }], rowCount: 1 };
      }
      // Archiving the replaced document.
      if (/UPDATE document_vault\s+SET status = 'ARCHIVED'/.test(q)) {
        record({ kind: "archive", docId: params[0] });
        return { rows: [], rowCount: 1 };
      }
      // The public serve joins, answered with the predicates the SQL carries.
      // The three mark/portrait slots have nothing in these fixtures; the
      // entity-cover join answers from the same state the transaction moved.
      if (/JOIN (site_leader|site_partner|site_credential|corporate_entity) o ON o\./.test(q)) {
        if (!/JOIN corporate_entity/.test(q)) return { rows: [], rowCount: 0 };
        const docId = params[0];
        const wantsScope = /v\.public_media_scope = 'SITE'/.test(q);
        const wantsOwner = /o\.public_cover_vault_id = v\.doc_id/.test(q);
        const passes =
          (!wantsScope || state.scopes[docId] === "SITE") &&
          (!wantsOwner || state.ownerPointer === docId);
        return {
          rows: passes
            ? [{ doc_id: docId, storage_path: `t/vault/${docId}.png`,
                public_media_content_type: "image/png",
                public_media_variants: { widths: [480], formats: ["webp"] } }]
            : [],
          rowCount: passes ? 1 : 0,
        };
      }
      throw new Error(`makeUploadClient: unrecognised statement: ${q.slice(0, 90)}`);
    },
  };
  return { client, state };
}

describe("the attachment outbox around a cover upload (PR-07, CE-25)", () => {
  const uploadOpts = (extra = {}) => ({
    slot: "entity-cover",
    ownerId: ENTITY,
    dataUrl: PNG_1PX,
    provenance: "owned",
    originalName: "cover.png",
    slug: "t",
    ...extra,
  });

  test("a successful upload books the whole ladder and ends LINKED", async () => {
    const { client, state } = makeUploadClient({ priorCoverId: OLD_DOC });
    const out = await media.upload(client, uploadOpts());
    expect(out.doc_id).toBe(mockNewDocId);

    const att = state.outbox[0];
    expect(att.kind).toBe("SITE_MEDIA");
    expect(att.owner_table).toBe("corporate_entity");
    expect(att.slot).toBe("entity-cover");
    expect(att.state).toBe("LINKED");
    expect(att.vault_doc_id).toBe(mockNewDocId);
    // The derivative keys the writer wrote are recorded on the attempt — the
    // vault row's own variants column is written by the pointer transaction
    // and cannot be the sweep's source of truth.
    expect(Array.isArray(JSON.parse(att.variant_keys))).toBe(true);
    expect(JSON.parse(att.variant_keys).length).toBeGreaterThan(0);
    // And the replacement really happened.
    expect(state.ownerPointer).toBe(mockNewDocId);
    expect(state.scopes[mockNewDocId]).toBe("SITE");
    expect(state.archived).toEqual([OLD_DOC]);
  });

  test("archives the cover current AT COMMIT TIME, not the one the request first saw (PR-10 / B.4)", async () => {
    // A concurrent replacement landed between this request's first owner
    // read and its pointer transaction: the entity pointed at OLD_DOC when
    // the request arrived, and at CONCURRENT by the time it took the row
    // lock. The archive must take CONCURRENT — the pointer it actually
    // displaced. Archiving the stale OLD_DOC would leave the concurrent
    // uploader's document dangling: scoped SITE, VERIFIED, pointed at by
    // nobody, and invisible to the orphan sweep (whose predicate requires
    // a NULL scope).
    const CONCURRENT = "44444444-4444-4444-4444-444444444444";
    const { client, state } = makeUploadClient({ priorCoverId: OLD_DOC });
    state.pointerAtLock = CONCURRENT;

    const out = await media.upload(client, uploadOpts());

    expect(out.doc_id).toBe(mockNewDocId);
    expect(state.ownerPointer).toBe(mockNewDocId);
    expect(state.archived).toEqual([CONCURRENT]);
    // The stale first read's document was NOT archived a second time — it
    // was already the concurrent replacement's business.
    expect(state.archived).not.toContain(OLD_DOC);
  });

  test("a replacement whose pointer transaction fails leaves the previous cover servable", async () => {
    const { client, state } = makeUploadClient({
      priorCoverId: OLD_DOC,
      failOn: "SET public_cover_vault_id",
    });

    await expect(
      media.upload(client, uploadOpts()),
    ).rejects.toThrow("boom (injected)");

    // The bytes exist (vault.createDocument ran) and the outbox says so —
    // BYTES were stored, the LINK was not, and FAILED names it.
    const att = state.outbox[0];
    expect(att.state).toBe("FAILED");
    expect(att.vault_doc_id).toBe(mockNewDocId);
    expect(att.attempts).toBe("bump");
    expect(att.last_error).toContain("boom");

    // The transaction rolled back: the new object was never scoped public,
    // the previous cover was never archived, and the pointer never moved.
    expect(state.scopes[mockNewDocId]).toBeUndefined();
    expect(state.archived).toEqual([]);
    expect(state.ownerPointer).toBe(OLD_DOC);

    // THE PUBLIC-SAFETY PROPERTY: the old cover is still servable, the new
    // one is not — answered by the serve join the route runs, with the
    // predicates the SQL carries.
    expect(await media.publicMediaForServe(client, OLD_DOC)).toMatchObject({ doc_id: OLD_DOC });
    expect(await media.publicMediaForServe(client, mockNewDocId)).toBeNull();
  });

  test("a failed first upload is not publishable, and still names its state", async () => {
    const { client, state } = makeUploadClient({
      priorCoverId: null,
      failOn: "SET public_cover_vault_id",
    });

    await expect(media.upload(client, uploadOpts())).rejects.toThrow("boom (injected)");

    const att = state.outbox[0];
    expect(att.state).toBe("FAILED");
    expect(att.vault_doc_id).toBe(mockNewDocId);

    // Nothing is public: no scope, no pointer, no servable document at all.
    expect(state.scopes[mockNewDocId]).toBeUndefined();
    expect(state.ownerPointer).toBeNull();
    expect(await media.publicMediaForServe(client, mockNewDocId)).toBeNull();
    expect(await media.publicMediaForServe(client, OLD_DOC)).toBeNull();
  });

  test("a refusal before the bytes books no attempt at all", async () => {
    const { client, state } = makeUploadClient();
    await expect(
      media.upload(client, uploadOpts({ provenance: "generated" })),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      media.upload(client, uploadOpts({ dataUrl: "not-a-data-url" })),
    ).rejects.toMatchObject({ code: "BAD_FILE_TYPE" });
    expect(state.outbox).toEqual([]);
  });
});


/* ── the slot register ──────────────────────────────────────────────────────*/

describe("the slot register", () => {
  test("every slot the shared schema offers has an owner on the server", () => {
    // The two halves are in different packages on purpose — the client needs
    // the constraints, the server needs the tables — so nothing but a test
    // stops one growing a slot the other has never heard of. A slot with no
    // owner would validate, reach the service, and 422 with "Unknown slot".
    expect(Object.keys(media.OWNERS).sort()).toEqual(siteSettings.SITE_MEDIA_SLOT_IDS.sort());
  });

  test("every slot is an evidence slot, so none of them accepts generated imagery", () => {
    // §1.3's list is leadership portraits, entity covers and service covers.
    // The two MARK slots are here as well, and deliberately: a generated
    // version of another company's trademark is a worse failure than a
    // generated portrait, not a lesser one. If a later PR adds an ATMOSPHERE
    // slot — the one place generated imagery is legitimate — this test is the
    // thing that has to be updated deliberately rather than discovered.
    for (const [slot, spec] of Object.entries(siteSettings.SITE_MEDIA_SLOTS)) {
      expect(`${slot}:${spec.evidence}`).toBe(`${slot}:true`);
    }
  });

  test("the two slots that sit on a dark band require transparency", () => {
    // O-3. A carrier's mark and a certifier's mark are the ones §9.4 puts on a
    // dark ground; a portrait and an entity cover are photographs on their own
    // plate and are supposed to be opaque.
    expect(siteSettings.SITE_MEDIA_SLOTS["partner-mark"].transparent).toBe(true);
    expect(siteSettings.SITE_MEDIA_SLOTS["credential-mark"].transparent).toBe(true);
    expect(siteSettings.SITE_MEDIA_SLOTS["leader-portrait"].transparent).toBe(false);
    expect(siteSettings.SITE_MEDIA_SLOTS["entity-cover"].transparent).toBe(false);
  });

  test("SVG is not an accepted type", () => {
    // The vault's sniffer works on magic bytes and SVG has none, so `sniff:
    // true` would have to be turned off for exactly the format that most needs
    // it — and an SVG served from this origin is markup the browser executes.
    // §9.4's "SVG or transparent PNG @2x" is answered by the second half.
    expect(media.IMAGE_TYPES).not.toContain("image/svg+xml");
    expect(media.IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});

/* ── §1.3, in the service ───────────────────────────────────────────────────*/

describe("provenance", () => {
  const client = { async query() { return { rows: [], rowCount: 0 }; } };

  test("refuses a generated image for an evidence slot, and says why", async () => {
    await expect(
      media.upload(client, {
        slot: "leader-portrait",
        ownerId: "11111111-1111-1111-1111-111111111111",
        dataUrl: "data:image/png;base64,AAAA",
        provenance: "generated",
      }),
    ).rejects.toMatchObject({
      status: 422,
      // The MESSAGE matters as much as the refusal: an administrator who is
      // told "invalid provenance" uploads the same file again under a
      // different word.
      message: expect.stringContaining("§1.3"),
    });
  });

  test("the refusal happens before the file is even parsed", async () => {
    // Ordering, not politeness: it means a 40 MB generated portrait is refused
    // without being base64-decoded into memory first. The data URL below is not
    // a valid image, and a run that reached `parseDataUrl` would fail with
    // BAD_FILE_TYPE instead.
    await expect(
      media.upload(client, {
        slot: "entity-cover",
        ownerId: "11111111-1111-1111-1111-111111111111",
        dataUrl: "not-a-data-url",
        provenance: "generated",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("an unknown slot is refused rather than looked up", async () => {
    await expect(
      media.upload(client, { slot: "hero-atmosphere", ownerId: "x", provenance: "owned" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

/* ── the shared schema, which is what the route actually validates ──────────*/

describe("the upload body", () => {
  const valid = {
    slot: "partner-mark",
    owner_id: "11111111-1111-1111-1111-111111111111",
    provenance: "owned",
    data_url: "data:image/png;base64,AAAA",
  };
  const parse = (patch) => siteSettings.siteMediaUpload.safeParse({ ...valid, ...patch });

  test("accepts a complete body", () => {
    expect(parse({}).success).toBe(true);
  });

  test("refuses a slot outside the register", () => {
    expect(parse({ slot: "service-cover" }).success).toBe(false);
  });

  test("refuses a provenance outside §1.3's three words", () => {
    expect(parse({ provenance: "stock" }).success).toBe(false);
  });

  test("requires a provenance at all — §6.3 makes it a required field", () => {
    const without = { ...valid };
    delete without.provenance;
    expect(siteSettings.siteMediaUpload.safeParse(without).success).toBe(false);
  });

  test("refuses an unknown field rather than ignoring it", () => {
    // `.strict()`. A body carrying `is_active: true` alongside an upload would
    // otherwise be silently dropped, which reads to the caller as accepted.
    expect(parse({ is_active: true }).success).toBe(false);
  });
});

/* ── the variant resolver: what it refuses ──────────────────────────────────*/

describe("resolveVariant", () => {
  const doc = {
    storage_path: "tenant_smartls/vault/doc_abc123.png",
    public_media_variants: { widths: [480, 960], formats: ["avif", "webp"] },
  };

  test("resolves a width and format the row actually records", () => {
    expect(media.resolveVariant(doc, "960", "avif")).toEqual({
      key: "tenant_smartls/vault/doc_abc123@960.avif",
      contentType: "image/avif",
    });
  });

  test("refuses a width that was never written", () => {
    // sharp never upscales, so a 700 px logo has no 1600 rung. A srcset
    // advertising one would be a 404 per visitor per image.
    expect(media.resolveVariant(doc, "1600", "avif")).toBeNull();
  });

  test("refuses a format that was never written", () => {
    expect(media.resolveVariant(doc, "960", "jxl")).toBeNull();
  });

  test("refuses a document with no ladder at all", () => {
    expect(media.resolveVariant({ ...doc, public_media_variants: null }, "960", "avif")).toBeNull();
  });

  test("no part of the request reaches the key", () => {
    // The width and the format are compared against the recorded arrays BEFORE
    // `variantKey` is called, so there is no path in which a caller's string is
    // concatenated into a storage key. Traversal, absolute paths and a
    // different extension are all simply "not in the list".
    expect(media.resolveVariant(doc, "../../etc/passwd", "avif")).toBeNull();
    expect(media.resolveVariant(doc, "960", "../webp")).toBeNull();
    expect(media.resolveVariant(doc, "960.0", "avif")).toBeNull();
  });
});

describe("variantKey", () => {
  test("replaces the extension rather than appending to it", () => {
    expect(media.variantKey("t/vault/doc_a.png", 480, "webp")).toBe("t/vault/doc_a@480.webp");
    expect(media.variantKey("t/vault/doc_a.jpeg", 1600, "avif")).toBe("t/vault/doc_a@1600.avif");
  });

  test("a key with dots in the directory keeps them", () => {
    // The regex is anchored to the END, so only the real extension moves.
    expect(media.variantKey("t.v1/vault/doc_a.png", 480, "webp")).toBe("t.v1/vault/doc_a@480.webp");
  });
});

/* ── the entity cover's lifecycle gate (Decision Q1, CE-27) ─────────────────
 *
 * The media routes answer `Cache-Control: public, max-age=31536000,
 * immutable`, so a cover URL a visitor has already loaded keeps being requested
 * for a YEAR after the entity is deactivated. Dropping the entity from the
 * JSON read is therefore not enough — the byte route has to refuse on its OWN
 * owner join, or the JSON says "not public" while the bytes keep saying
 * "200 OK" from every cache in between.
 *
 * The first test asserts the predicate on the OWNER SQL itself, in the
 * register the service actually runs. The second drives `publicMediaForServe`
 * through a client that applies the predicates the SQL carries — the same
 * trick as the lifecycle tests in site-public-redaction.test.js — so a
 * predicate deleted from the query stops filtering and the cover leaks back
 * into the result.
 */
describe("the entity cover serve join (Q1, CE-27)", () => {
  const serve = media.OWNERS["entity-cover"].serve;

  test("the owner join requires the public switch AND the ACTIVE lifecycle state", () => {
    expect(serve).toMatch(/o\.public_enabled\s*=\s*true/);
    expect(serve).toMatch(/o\.registration_status\s*=\s*'ACTIVE'/);
    // The LADDER, not the derived boolean: is_active is the compatibility
    // surface the 0515 trigger keeps in step, and a NULL ladder row must fail
    // closed rather than pass open.
    expect(serve).not.toMatch(/o\.is_active/);
  });

  test("a cover whose owner left the ACTIVE ladder stops being servable — cached URLs 404", async () => {
    const DOC_ID = "11111111-1111-1111-1111-111111111111";
    const doc = {
      doc_id: DOC_ID,
      storage_path: "t/vault/doc_a.png",
      public_media_content_type: "image/png",
      public_media_variants: { widths: [480], formats: ["webp"] },
    };
    /** Applies the predicates the SQL carries to the configured owner, so the
     *  stub tests the QUERY AS WRITTEN rather than a copy of its intent. */
    function serveClient(ownerStatus, ownerEnabled) {
      return {
        async query(text) {
          const q = String(text);
          if (!/JOIN corporate_entity/.test(q)) return { rows: [] };
          const wantsEnabled = /o\.public_enabled\s*=\s*true/.test(q);
          const wantsActive = /o\.registration_status\s*=\s*'ACTIVE'/.test(q);
          const ownerPasses =
            (!wantsEnabled || ownerEnabled) && (!wantsActive || ownerStatus === "ACTIVE");
          return { rows: ownerPasses ? [doc] : [] };
        },
      };
    }

    // ACTIVE and public: servable, as it always was.
    expect(await media.publicMediaForServe(serveClient("ACTIVE", true), DOC_ID)).toMatchObject({
      doc_id: DOC_ID,
    });
    // Every non-ACTIVE ladder state with the switch still on: 404 at the route.
    for (const state of ["DRAFT", "PENDING_REVIEW", "SUSPENDED", "DEACTIVATED", "ARCHIVED"]) {
      expect(await media.publicMediaForServe(serveClient(state, true), DOC_ID)).toBeNull();
    }
    // And the switch alone was never the whole gate either.
    expect(await media.publicMediaForServe(serveClient("ACTIVE", false), DOC_ID)).toBeNull();
  });
});
