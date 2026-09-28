"use strict";

/**
 * The certified PDF of a client's conversation (PRD §11.1), since the chat
 * learned to carry photos, voice notes and pins (14170).
 *
 * A message with no words used to print as an empty box, and every timestamp
 * printed as "Mon Sep 28 2026" — `String(date).slice(0, 16)` over the Date pg
 * hands back. The copy now says what was sent and when, day-first, in the
 * client's own timezone.
 */

let mockHtml = null;

jest.mock("../../src/modules/portal/portal.repo", () => ({
  clientMessages: async () => [
    { message_id: "m1", direction: "CLIENT", author_email: "marie@acme.cm", body: "", dossier_ref: "PRX-1", created_at: new Date("2026-09-28T10:00:00Z"), location_lat: null },
    { message_id: "m2", direction: "CLIENT", author_email: "marie@acme.cm", body: "", dossier_ref: "PRX-1", created_at: new Date("2026-09-28T10:05:00Z"), location_lat: null },
    { message_id: "m3", direction: "CLIENT", author_email: "marie@acme.cm", body: "", dossier_ref: null, created_at: new Date("2026-09-28T10:06:00Z"), location_lat: "4.047211", location_lng: "9.704562", location_label: "Warehouse B" },
    { message_id: "m4", direction: "STAFF", author_name: "Paul Ekambi", body: "Seal intact.", dossier_ref: "PRX-1", created_at: new Date("2026-09-28T10:07:00Z"), location_lat: null },
  ],
}));
jest.mock("../../src/services/pdf.service", () => ({
  renderAndStore: async (c, { html }) => {
    mockHtml = html;
    return { doc_id: "d1", verify: "v" };
  },
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: async () => ({ buffer: Buffer.from("%PDF") }),
}));

const service = require("../../src/modules/portal/portal.service");

const client = {
  query: async (sql) => {
    if (/client_message_attachment/.test(sql)) {
      return {
        rows: [
          { message_id: "m1", kind: "IMAGE", file_name: "seal.jpg", duration_ms: null },
          { message_id: "m2", kind: "VOICE", file_name: "voice.webm", duration_ms: 14000 },
        ],
      };
    }
    if (/timezone FROM client_master/.test(sql)) return { rows: [{ timezone: "Africa/Douala" }] };
    return { rows: [] };
  },
};

it("says what each message carried, and when, day-first in the client's timezone", async () => {
  const out = await service.exportClientChat(client, { clientId: "c1" });
  expect(out.count).toBe(4);
  expect(mockHtml).toContain("[Photo: seal.jpg]");
  expect(mockHtml).toContain("[Voice note, 0:14]");
  expect(mockHtml).toContain("[Location: Warehouse B, 4.04721, 9.70456]");
  expect(mockHtml).toContain("Seal intact.");
  // Douala is UTC+1: 10:00Z is 11:00 on the client's wall.
  expect(mockHtml).toContain("28/09/2026 11:00");
  expect(mockHtml).not.toMatch(/Mon Sep/);
  // Which shipment a message was about rides in its header line.
  expect(mockHtml).toContain("marie@acme.cm · PRX-1");
});
