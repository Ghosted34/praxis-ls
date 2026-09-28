"use strict";

/**
 * 14160 — a final invoice's supporting documents, shared with the client.
 *
 *   1. Before the first publication, the documents a cash request marked as
 *      owing a receipt are suggested; afterwards, what finance actually shared.
 *   2. Only documents from THIS invoice's file can be shared through it, and
 *      only once the invoice is issued.
 *   3. The client's copy is in the file's order, numbered, and "download all"
 *      is one ZIP holding the invoice and every shared document.
 *   4. A document not in the client's bundle is not downloadable by them.
 */

let mockRepo;
let mockEvents = [];
let mockAudits = [];
const mockBytes = { d1: Buffer.from("port receipt"), d2: Buffer.from("demurrage"), d3: Buffer.from("internal") };

jest.mock("../../src/modules/portal/invoice_bundle.repo", () => new Proxy({}, {
  get: (_t, name) => (...args) => {
    if (!mockRepo[name]) throw new Error(`repo.${String(name)} not mocked`);
    return mockRepo[name](...args);
  },
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: async (c, id) => ({ doc: {}, buffer: mockBytes[id] || Buffer.from("?") }),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async (c, e) => {
    mockEvents.push(e);
  },
  audit: async (c, a) => {
    mockAudits.push(a);
  },
  resolveActorId: async (c, id) => id || null,
}));

const service = require("../../src/modules/portal/invoice_bundle.service");

const client = { query: jest.fn(async () => ({ rows: [] })) };

const CANDIDATES = [
  { doc_id: "d1", note: null, original_name: "pad-receipt.pdf", storage_path: "k/doc_1.pdf", line_no: 1, line_label: "Port charges (PAD)", justification_required: true, uploaded_at: "2026-09-01" },
  { doc_id: "d2", note: "Maersk demurrage", original_name: "inv-778.pdf", storage_path: "k/doc_2.pdf", line_no: 2, line_label: "Demurrage", justification_required: true, uploaded_at: "2026-09-02" },
  { doc_id: "d3", note: null, original_name: "fuel.jpg", storage_path: "k/doc_3.jpg", line_no: 3, line_label: "Fuel (internal)", justification_required: false, uploaded_at: "2026-09-03" },
];

let bundle;

beforeEach(() => {
  mockEvents = [];
  mockAudits = [];
  bundle = null;
  client.query.mockClear();
  mockRepo = {
    invoice: async () => ({ invoice_id: "i1", doc_number: "FAC-2026-1182", client_id: "c1", dossier_id: "f1", status: "ISSUED_LOCKED", currency: "XAF", total_ttc: "1850000" }),
    candidates: async () => CANDIDATES,
    bundleFor: async () => bundle,
    clientBundle: async (_c, { clientId }) => (clientId === "c1" ? bundle : null),
    upsertBundle: async (c, row) => ({ bundle_id: "b1", ...row }),
    replaceItems: async (c, bundleId, items) => {
      bundle = {
        bundle_id: bundleId,
        published_at: "2026-09-28T10:00:00Z",
        items: items.map((it) => ({ ...CANDIDATES.find((x) => x.doc_id === it.doc_id), ...it })),
      };
    },
    deleteBundle: async () => {
      const had = !!bundle;
      bundle = null;
      return had;
    },
  };
});

describe("what finance is offered", () => {
  it("suggests the documents owed as receipts before anything is shared", async () => {
    const v = await service.staffView(client, { invoiceId: "i1" });
    expect(v.published).toBeNull();
    expect(v.candidates.map((x) => [x.doc_id, x.in_bundle])).toEqual([
      ["d1", true],
      ["d2", true],
      ["d3", false],
    ]);
    // The uploader's note names a document before its file name does.
    expect(v.candidates[1].name).toBe("Maersk demurrage");
    expect(v.candidates[0].name).toBe("pad-receipt");
  });

  it("shows what was actually shared once finance has decided", async () => {
    await service.publish(client, { invoiceId: "i1", docIds: ["d2"], actor: { user_id: "u1" } });
    const v = await service.staffView(client, { invoiceId: "i1" });
    expect(v.candidates.filter((x) => x.in_bundle).map((x) => x.doc_id)).toEqual(["d2"]);
    expect(v.published.items).toHaveLength(1);
  });
});

describe("publishing", () => {
  it("shares in the file's order, whatever order the ticks came in", async () => {
    const v = await service.publish(client, { invoiceId: "i1", docIds: ["d3", "d1"], actor: { user_id: "u1" } });
    expect(v.published.items.map((i) => [i.doc_id, i.position, i.label])).toEqual([
      ["d1", 1, "Port charges (PAD)"],
      ["d3", 2, "Fuel (internal)"],
    ]);
    expect(mockEvents.map((e) => e.eventTypeKey)).toContain("invoice_bundle.published");
    expect(mockEvents[0].payload).toMatchObject({ client_id: "c1", documents: 2 });
  });

  it("refuses a document that is not on this invoice's file", async () => {
    await expect(service.publish(client, { invoiceId: "i1", docIds: ["d1", "someone-elses"] })).rejects.toMatchObject({
      code: "NOT_ON_THIS_FILE",
    });
    expect(bundle).toBeNull();
  });

  it("refuses an invoice the client cannot see yet", async () => {
    mockRepo.invoice = async () => ({ invoice_id: "i1", client_id: "c1", dossier_id: "f1", status: "DRAFT" });
    await expect(service.publish(client, { invoiceId: "i1", docIds: ["d1"] })).rejects.toMatchObject({ code: "INVOICE_NOT_ISSUED" });
  });

  it("withdraws without touching the documents", async () => {
    await service.publish(client, { invoiceId: "i1", docIds: ["d1"] });
    const v = await service.withdraw(client, { invoiceId: "i1", actor: {} });
    expect(v.published).toBeNull();
    expect(mockAudits.map((a) => a.action)).toContain("invoice_bundle.withdrawn");
  });
});

describe("the client's side", () => {
  it("downloads everything as one ZIP: the invoice first, then each document, numbered", async () => {
    await service.publish(client, { invoiceId: "i1", docIds: ["d1", "d2"] });
    const out = await service.clientZip(client, {
      clientId: "c1",
      invoiceId: "i1",
      invoicePdf: async () => ({ buffer: Buffer.from("%PDF-invoice"), name: "FAC-2026-1182.pdf" }),
    });
    expect(out.type).toBe("application/zip");
    expect(out.name).toBe("FAC-2026-1182-documents.zip");
    const text = out.buffer.toString("latin1");
    // Local file header signature, and every entry by its numbered name (the
    // writer turns spaces into underscores).
    expect(out.buffer.readUInt32LE(0)).toBe(0x04034b50);
    expect(text).toContain("01_FAC-2026-1182.pdf");
    expect(text).toContain("02_Port_charges_(PAD)_pad-receipt.pdf");
    expect(text).toContain("03_Demurrage_Maersk_demurrage.pdf");
    expect(text).toContain("port receipt");
  });

  it("gives nothing to a client the bundle is not for", async () => {
    await service.publish(client, { invoiceId: "i1", docIds: ["d1"] });
    await expect(
      service.clientZip(client, { clientId: "someone-else", invoiceId: "i1", invoicePdf: async () => ({ buffer: Buffer.from("x"), name: "x.pdf" }) }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.clientFile(client, { clientId: "someone-else", invoiceId: "i1", docId: "d1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serves one shared document, and refuses one that is not shared", async () => {
    await service.publish(client, { invoiceId: "i1", docIds: ["d1"] });
    const one = await service.clientFile(client, { clientId: "c1", invoiceId: "i1", docId: "d1" });
    expect(one.name).toBe("pad-receipt.pdf");
    await expect(service.clientFile(client, { clientId: "c1", invoiceId: "i1", docId: "d3" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
