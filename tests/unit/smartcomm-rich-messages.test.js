"use strict";

/**
 * Smart Comms rich messages — the four things a chat needs, pinned.
 *
 * What is worth a test here is not "does an upload upload". It is the four
 * decisions that are invisible when they are right and expensive when they are
 * wrong:
 *
 *   1. A photo goes to chat media and a PDF goes to the vault. Get this
 *      backwards and the document register fills with screenshots, or a customs
 *      declaration ends up somewhere with no retention on it.
 *   2. An ERP card resolves against the READER. Get this wrong and the chat
 *      becomes a way to read every figure in the ERP by being added to a
 *      channel.
 *   3. A voice note's transcript distinguishes "no provider configured" from
 *      "it failed". Collapse them and the operator hunts a fault that is not
 *      theirs.
 *   4. A certified export contains the WORDS of a voice note, not "(media)".
 */

const media = require("../../src/modules/smartcomm/smartcomm.media.service");
const erp = require("../../src/modules/smartcomm/smartcomm.erp.service");
const repo = require("../../src/modules/smartcomm/smartcomm.repo");

describe("attachment routing — which store a file belongs in", () => {
  it("sends images, audio and video to chat media", () => {
    expect(media.routeFor("image/jpeg")).toEqual({ store: "MEDIA", kind: "IMAGE" });
    expect(media.routeFor("image/png")).toEqual({ store: "MEDIA", kind: "IMAGE" });
    expect(media.routeFor("video/mp4")).toEqual({ store: "MEDIA", kind: "VIDEO" });
    expect(media.routeFor("audio/webm")).toEqual({ store: "MEDIA", kind: "AUDIO" });
  });

  it("sends real documents to the vault", () => {
    expect(media.routeFor("application/pdf").store).toBe("VAULT");
    expect(media.routeFor("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").store).toBe("VAULT");
    expect(media.routeFor("text/csv").store).toBe("VAULT");
  });

  it("treats an unrecognised type as a document rather than refusing it", () => {
    // An operator who receives a .dwg or a .p7s must be able to put it in front
    // of a colleague without leaving the product, and the vault is the
    // destination with the audit trail.
    expect(media.routeFor("application/acad").store).toBe("VAULT");
    expect(media.routeFor("").store).toBe("VAULT");
    expect(media.routeFor(null).store).toBe("VAULT");
  });

  it("crosses the media-type parameters MediaRecorder attaches", () => {
    // `audio/webm;codecs=opus` is what every real recording declares. A Set
    // lookup that keeps the parameter matches nothing, which would have routed
    // every voice note to the vault as an unknown document.
    expect(media.routeFor("audio/webm;codecs=opus")).toEqual({ store: "MEDIA", kind: "AUDIO" });
    expect(media.routeFor("video/webm; codecs=vp8")).toEqual({ store: "MEDIA", kind: "VIDEO" });
    expect(media.routeFor("IMAGE/JPEG")).toEqual({ store: "MEDIA", kind: "IMAGE" });
  });
});

describe("waveform sanitising — peaks arrive from anyone who can POST", () => {
  it("clamps to 0..100 and rounds", () => {
    expect(media.cleanWaveform([-40, 0, 50.4, 99.6, 1e9])).toEqual([0, 0, 50, 100, 100]);
  });

  it("caps the array so one row cannot slow every later thread read", () => {
    expect(media.cleanWaveform(Array(500).fill(50))).toHaveLength(64);
  });

  it("returns null for nothing usable rather than an empty array", () => {
    expect(media.cleanWaveform([])).toBeNull();
    expect(media.cleanWaveform(null)).toBeNull();
    expect(media.cleanWaveform("50,60")).toBeNull();
  });

  it("survives non-numeric junk instead of storing NaN", () => {
    expect(media.cleanWaveform(["x", undefined, null, 20])).toEqual([0, 0, 0, 20]);
  });
});

/**
 * ── THE PEAKS REACH A jsonb COLUMN AS JSON, NOT AS A POSTGRES ARRAY ────────
 *
 * `cleanWaveform` hands back a JS ARRAY, and `comms_media.waveform` is jsonb.
 * node-postgres serialises a JS object to JSON but an ARRAY to a POSTGRES ARRAY
 * LITERAL — `{12,34}` — which is not JSON. Bound to jsonb that raises 22P02,
 * which the error handler turns into 400 INVALID_VALUE, "One of the values is
 * in the wrong format": a sentence naming no column and no field.
 *
 * It made EVERY voice note fail to send while the recording, the peaks and the
 * upload all worked, and it was invisible to the rest of this suite because an
 * image and a video carry no waveform — the one attachment kind with a jsonb
 * column was the one attachment kind that was broken.
 *
 * Asserted at the repo seam rather than through the service, because that is
 * where the encoding decision is made and where a later refactor would drop it.
 */
describe("waveform is encoded for jsonb before it is bound", () => {
  /** A client that records the parameters rather than reaching a database. */
  const spyClient = () => {
    const calls = [];
    return {
      calls,
      query: async (text, params) => {
        calls.push({ text, params });
        return { rows: [{ media_id: "m-1" }] };
      },
    };
  };

  it("binds the peaks as a JSON string, not as a JS array", async () => {
    const client = spyClient();
    await repo.insertMedia(client, {
      group_id: "g-1",
      kind: "AUDIO",
      storage_path: "k",
      content_type: "audio/webm",
      waveform: [12, 34, 56],
      is_voice_note: true,
    });
    const { text, params } = client.calls[0];
    const columns = text
      .slice(text.indexOf("(") + 1, text.indexOf(")"))
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""));
    const waveform = params[columns.indexOf("waveform")];
    expect(typeof waveform).toBe("string");
    expect(JSON.parse(waveform)).toEqual([12, 34, 56]);
  });

  it("passes a null waveform through as SQL NULL", async () => {
    // An image has no peaks. `JSON.stringify(null)` would bind the four
    // characters "null", which is the JSON document `null` rather than an
    // absent value — and a column read back as the string "null" is a
    // different bug wearing the same clothes.
    const client = spyClient();
    await repo.insertMedia(client, {
      group_id: "g-1",
      kind: "IMAGE",
      storage_path: "k",
      content_type: "image/jpeg",
      waveform: null,
    });
    const { text, params } = client.calls[0];
    const columns = text
      .slice(text.indexOf("(") + 1, text.indexOf(")"))
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""));
    expect(params[columns.indexOf("waveform")]).toBeNull();
  });

  it("leaves a row that never mentions waveform alone", async () => {
    // `jsonbFields` must not invent the column: adding `waveform: null` to
    // every media insert would be harmless here and wrong the moment the
    // column gains a default.
    const client = spyClient();
    await repo.insertMedia(client, {
      group_id: "g-1",
      kind: "VIDEO",
      storage_path: "k",
      content_type: "video/mp4",
    });
    expect(client.calls[0].text).not.toContain("waveform");
  });
});

describe("ERP references resolve against the READER, not the sender", () => {
  const INVOICE_ROW = {
    id: "inv-1", doc_number: "INV-2026-0041", type: "FINAL", status: "POSTED_LOCKED",
    total_ttc: "1250000.00", currency: "XAF", created_at: "2026-07-27T08:00:00Z",
    payment_due_on: "2026-08-26", client_name: "Somaf SARL",
  };
  const client = { query: async () => ({ rows: [INVOICE_ROW] }) };

  it("gives a permitted reader the figures", async () => {
    const card = await erp.resolve(client, {
      kind: "INVOICE", id: "inv-1", allow: new Set(["MOD-51"]),
    });
    expect(card.redacted).toBe(false);
    expect(card.ref).toBe("INV-2026-0041");
    expect(card.amount).toBe(1250000);
    expect(card.currency).toBe("XAF");
    expect(card.url).toBe("/finance/invoices/inv-1");
  });

  it("gives a reader without the right the reference and NO amount", async () => {
    const card = await erp.resolve(client, {
      kind: "INVOICE", id: "inv-1", label: "INV-2026-0041", allow: new Set(),
    });
    expect(card.redacted).toBe(true);
    expect(card.ref).toBe("INV-2026-0041");
    expect(card.amount).toBeNull();
    expect(card.currency).toBeNull();
    expect(card.status).toBeNull();
    // No link either: one that leads to a 403 reads as a bug rather than as a
    // permission.
    expect(card.url).toBeNull();
  });

  it("separates proformas from final invoices, which are different rights", async () => {
    // Both live in `invoice`; MOD-50 is quoting a price and MOD-51 is billing
    // for it. A sales user with proforma access must not read final invoices
    // through a chat bubble.
    const proforma = { query: async () => ({ rows: [{ ...INVOICE_ROW, type: "PROFORMA" }] }) };
    const asSales = new Set(["MOD-50"]);

    expect((await erp.resolve(proforma, { kind: "INVOICE", id: "inv-1", allow: asSales })).redacted).toBe(false);
    expect((await erp.resolve(client, { kind: "INVOICE", id: "inv-1", allow: asSales })).redacted).toBe(true);
  });

  it("redacts a record that has been deleted since it was attached", async () => {
    // Not a 404 that would blank the bubble: the message still happened, and
    // "this referred to INV-2026-0041" is the true thing to show.
    const gone = { query: async () => ({ rows: [] }) };
    const card = await erp.resolve(gone, {
      kind: "INVOICE", id: "inv-1", label: "INV-2026-0041", allow: new Set(["MOD-51"]),
    });
    expect(card.redacted).toBe(true);
    expect(card.ref).toBe("INV-2026-0041");
  });

  it("redacts an unknown kind rather than throwing into the thread read", async () => {
    const card = await erp.resolve(client, {
      kind: "PAYROLL_RUN", id: "x", label: "PR-9", allow: new Set(["MOD-51"]),
    });
    expect(card.redacted).toBe(true);
  });

  it("omits a kind the reader cannot see from search entirely", async () => {
    // Absent, not redacted: a picker is a list of things you MAY attach, and a
    // row that turns into "restricted" on send is a worse answer than no row.
    const rows = await erp.search(client, { term: "INV", allow: new Set() });
    expect(rows).toEqual([]);
  });

  it("refuses a search term too short to mean anything", async () => {
    await expect(erp.search(client, { term: "I", allow: new Set(["MOD-51"]) })).rejects.toMatchObject({
      code: "BAD_SEARCH",
    });
  });
});

describe("voice note transcription — three failures that need three sentences", () => {
  const mediaId = "m-1";
  const row = { media_id: mediaId, is_voice_note: true, content_type: "audio/webm", storage_path: "k" };

  function withMocks({ storageGet, transcribe }) {
    jest.resetModules();
    jest.doMock("../../src/services/storage.service", () => ({ get: storageGet, put: jest.fn() }));
    jest.doMock("../../src/services/ai/transcription.service", () => ({ transcribe }));
    const repo = require("../../src/modules/smartcomm/smartcomm.repo");
    jest.spyOn(repo, "getMedia").mockResolvedValue(row);
    const setTranscript = jest.spyOn(repo, "setMediaTranscript").mockImplementation(
      async (_c, id, patch) => ({ media_id: id, ...patch }),
    );
    return { svc: require("../../src/modules/smartcomm/smartcomm.media.service"), setTranscript };
  }

  afterEach(() => jest.restoreAllMocks());

  it("stores the words on success", async () => {
    const { svc, setTranscript } = withMocks({
      storageGet: async () => Buffer.from("clip"),
      transcribe: async () => ({ text: "  Ship it tomorrow  " }),
    });
    await svc.transcribeVoiceNote({}, mediaId);
    expect(setTranscript).toHaveBeenCalledWith({}, mediaId, {
      transcript: "Ship it tomorrow",
      status: "DONE",
    });
  });

  it("is DONE with no words when the clip held no speech", async () => {
    const { svc, setTranscript } = withMocks({
      storageGet: async () => Buffer.from("clip"),
      transcribe: async () => ({ text: "   " }),
    });
    await svc.transcribeVoiceNote({}, mediaId);
    expect(setTranscript).toHaveBeenCalledWith({}, mediaId, { transcript: null, status: "DONE" });
  });

  it("says UNAVAILABLE, not FAILED, when no provider is configured", async () => {
    // The operator's problem, not the reader's. "Failed" would send somebody
    // hunting a fault that is not theirs.
    const { svc, setTranscript } = withMocks({
      storageGet: async () => Buffer.from("clip"),
      transcribe: async () => { throw new Error("voice transcription provider not configured (Groq/Whisper key missing)"); },
    });
    await svc.transcribeVoiceNote({}, mediaId);
    expect(setTranscript).toHaveBeenCalledWith({}, mediaId, { transcript: null, status: "UNAVAILABLE" });
  });

  it("says FAILED when a provider answered badly", async () => {
    const { svc, setTranscript } = withMocks({
      storageGet: async () => Buffer.from("clip"),
      transcribe: async () => { throw new Error("502 upstream"); },
    });
    await svc.transcribeVoiceNote({}, mediaId);
    expect(setTranscript).toHaveBeenCalledWith({}, mediaId, { transcript: null, status: "FAILED" });
  });

  it("never throws — the clip is the message, the words are a bonus", async () => {
    const { svc } = withMocks({
      storageGet: async () => { throw new Error("storage down"); },
      transcribe: async () => ({ text: "unused" }),
    });
    await expect(svc.transcribeVoiceNote({}, mediaId)).resolves.not.toThrow();
  });
});

describe("certified export — a voice note is its words, not '(media)'", () => {
  /**
   * `certifiedExport` SHA-256s one line per message into a vault document that
   * MOD-66 can verify. A voice note used to render as "(media)", which meant
   * the one format people reach for when an instruction is urgent was the one
   * format that vanished from the legal record of the channel.
   */
  function loadService({ messages, transcripts }) {
    jest.resetModules();
    jest.doMock("../../src/services/documents/document.service", () => ({
      capture: jest.fn(async () => ({ doc_id: "doc-1" })),
    }));
    jest.doMock("../../src/shared/events/emit", () => ({
      emitEvent: jest.fn(async () => {}),
      audit: jest.fn(async () => {}),
      resolveActorId: jest.fn(async (_c, id) => id),
    }));
    const repo = require("../../src/modules/smartcomm/smartcomm.repo");
    jest.spyOn(repo, "findMember").mockResolvedValue({ user_id: "u-1" });
    jest.spyOn(repo, "listMessages").mockResolvedValue(messages);
    jest.spyOn(repo, "voiceTranscriptsForGroup").mockResolvedValue(transcripts);
    const documents = require("../../src/services/documents/document.service");
    return { service: require("../../src/modules/smartcomm/smartcomm.service"), documents };
  }

  afterEach(() => jest.restoreAllMocks());

  const AT = "2026-09-14T07:59:00.000Z";

  it("writes the spoken words into the hashed transcript", async () => {
    const { service, documents } = loadService({
      messages: [
        { message_id: "m-1", created_at: AT, sender_user_id: "u-1", body: "Morning" },
        { message_id: "m-2", created_at: AT, sender_user_id: "u-2", body: null },
      ],
      transcripts: [{ message_id: "m-2", transcript: "Clear it through customs today" }],
    });
    await service.certifiedExport({ query: async () => ({ rows: [] }) }, {
      groupId: "g-1", actor: { user_id: "u-1" },
    });
    // The hash is taken over the transcript text, so asserting on what was
    // captured is asserting on what the signature covers.
    expect(documents.capture).toHaveBeenCalledTimes(1);
    const hashed = documents.capture.mock.calls[0][1];
    expect(hashed.docType).toBe("COMMS_CERTIFIED_EXPORT");
    expect(hashed.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("still says (media) for a clip with no transcript, and (deleted) for a removed message", async () => {
    const { service } = loadService({
      messages: [
        { message_id: "m-3", created_at: AT, sender_user_id: "u-2", body: null },
        { message_id: "m-4", created_at: AT, sender_user_id: "u-2", body: null, deleted_at: AT },
      ],
      transcripts: [],
    });
    const out = await service.certifiedExport({ query: async () => ({ rows: [] }) }, {
      groupId: "g-1", actor: { user_id: "u-1" },
    });
    expect(out.message_count).toBe(2);
    expect(out.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces a DIFFERENT hash once a transcript lands", async () => {
    // The point of the change: the same two messages hash differently with and
    // without the words, which is what proves the words are actually in the
    // certified record rather than merely displayed next to it.
    const messages = [{ message_id: "m-5", created_at: AT, sender_user_id: "u-2", body: null }];

    const bare = loadService({ messages, transcripts: [] });
    const a = await bare.service.certifiedExport({ query: async () => ({ rows: [] }) }, {
      groupId: "g-1", actor: { user_id: "u-1" },
    });
    jest.restoreAllMocks();

    const spoken = loadService({ messages, transcripts: [{ message_id: "m-5", transcript: "Ship it" }] });
    const b = await spoken.service.certifiedExport({ query: async () => ({ rows: [] }) }, {
      groupId: "g-1", actor: { user_id: "u-1" },
    });

    expect(a.content_hash).not.toBe(b.content_hash);
  });
});

describe("CodeQL findings — a URL is not a trusted lookup key", () => {
  /**
   * Three alerts, one root cause each, all reachable from a query string.
   *
   *   `REGISTRY[kind]` / `MODULE_FOR[kind]` — a plain object carries
   *   Object.prototype, so a kind of "constructor" or "toString" resolves to a
   *   real function and calling it is an unvalidated dynamic dispatch. Both are
   *   Maps now: an unknown key is `undefined`, with no prototype to fall back
   *   through.
   *
   *   `term.length` in `search` — `?q=a&q=b` is an ARRAY. Its `.length` is the
   *   number of parameters, not the number of characters, so a two-parameter
   *   search of one letter each passed a guard meant to reject it.
   */

  it("does not dispatch through the prototype for a made-up kind", async () => {
    const client = { query: async () => ({ rows: [] }) };
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      // eslint-disable-next-line no-await-in-loop -- five cheap assertions, order irrelevant
      const card = await erp.resolve(client, { kind, id: "x", label: "L", allow: new Set(["MOD-51"]) });
      expect(card.redacted).toBe(true);
      expect(card.ref).toBe("L");
    }
  });

  it("holds no callable to invoke, so there is no dynamic dispatch left", () => {
    // The Map fixed the LOOKUP; this is what fixes the CALL. A Map of closures
    // still reads as "invoke a value obtained by indexing with user input",
    // which is what the query is actually about — it flagged that version too.
    // Reading the source is crude, and it is the only way to catch a tidy-up
    // that turns the records back into functions.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "..", "src", "modules", "smartcomm", "smartcomm.erp.service.js"),
      "utf8",
    );
    const table = src.slice(src.indexOf("const MODULE_FOR"), src.indexOf("function moduleFor"));
    expect(table).not.toMatch(/=>/);
    expect(table).toMatch(/\{ module: "MOD-51", proforma: "MOD-50" \}/);
  });

  it("resolves a module only for a kind it actually knows", () => {
    expect(erp.moduleFor("INVOICE", { type: "FINAL" })).toBe("MOD-51");
    expect(erp.moduleFor("INVOICE", { type: "PROFORMA" })).toBe("MOD-50");
    expect(erp.moduleFor("constructor", null)).toBeNull();
    expect(erp.moduleFor("toString", null)).toBeNull();
    expect(erp.moduleFor(undefined, null)).toBeNull();
  });

  it("ignores a prototype key in the kinds filter rather than calling it", async () => {
    const client = { query: async () => ({ rows: [] }) };
    await expect(
      erp.search(client, { term: "INV", kinds: ["constructor", "toString"], allow: new Set(["MOD-51"]) }),
    ).resolves.toEqual([]);
  });

  it("measures the CHARACTERS of a search term, not the number of parameters", async () => {
    const service = require("../../src/modules/smartcomm/smartcomm.service");
    const repo = require("../../src/modules/smartcomm/smartcomm.repo");
    const searchMessages = jest.spyOn(repo, "searchMessages").mockResolvedValue([]);
    try {
      // `?q=a&q=b` — two one-character values. Before the fix `.length` read 2
      // and this was accepted, then searched for the string "a,b".
      await expect(
        service.search({}, { actor: { user_id: "u-1" }, term: ["a", "b"] }),
      ).resolves.toEqual([]);
      expect(searchMessages).toHaveBeenCalledWith({}, "u-1", "a,b");

      searchMessages.mockClear();
      await expect(
        service.search({}, { actor: { user_id: "u-1" }, term: ["a"] }),
      ).rejects.toMatchObject({ code: "BAD_SEARCH" });
      expect(searchMessages).not.toHaveBeenCalled();

      // And a plain string still behaves exactly as it did.
      await service.search({}, { actor: { user_id: "u-1" }, term: "  invoice  " });
      expect(searchMessages).toHaveBeenCalledWith({}, "u-1", "invoice");
    } finally {
      searchMessages.mockRestore();
    }
  });
});
