"use strict";

jest.mock("../../src/modules/sales/success_story/success_story.repo", () => ({
  eligibleByIds: jest.fn(), eligible: jest.fn(), dossiers: jest.fn(),
  insert: jest.fn(), replaceDossiers: jest.fn(), get: jest.fn(), update: jest.fn(), list: jest.fn(),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(), audit: jest.fn(), resolveActorId: jest.fn(async (_client, id) => id || null),
}));
jest.mock("../../src/services/ai/llm.service", () => ({ chat: jest.fn() }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(), recordUsage: jest.fn(),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: jest.fn(),
}));
jest.mock("../../src/services/storage.service", () => ({ get: jest.fn(), delete: jest.fn() }));

const fs = require("fs");
const path = require("path");
const repo = require("../../src/modules/sales/success_story/success_story.repo");
const storage = require("../../src/services/storage.service");
const service = require("../../src/modules/sales/success_story/success_story.service");
const publicStory = require("../../src/modules/sales/portfolio_public/portfolio_public.service");

const DOSSIER = "11111111-1111-4111-8111-111111111111";
const STORY = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const eligible = { dossier_id: DOSSIER, ref: "DOS-1", status: "COMPLETED" };
const fakeClient = () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) });

beforeEach(() => {
  jest.clearAllMocks();
  repo.eligibleByIds.mockResolvedValue([eligible]);
  repo.dossiers.mockResolvedValue([eligible]);
  repo.get.mockResolvedValue({ success_story_id: STORY, signed_off_by: "user-old", is_published: false });
  repo.update.mockImplementation(async (_client, id, fields) => ({ success_story_id: id, ...fields }));
});

describe("F11 governed stories", () => {
  test("requires at least one eligible dossier and rejects partial eligibility", async () => {
    await expect(service.validateDossiers({}, [])).rejects.toMatchObject({ code: "DOSSIERS_REQUIRED" });
    repo.eligibleByIds.mockResolvedValueOnce([eligible]);
    await expect(service.validateDossiers({}, [DOSSIER, "44444444-4444-4444-8444-444444444444"]))
      .rejects.toMatchObject({ code: "INELIGIBLE_DOSSIER" });
  });

  test("material content edits clear stale sign-off", async () => {
    const client = fakeClient();
    await service.update(client, {
      id: STORY,
      patch: { executive_summary: "New approved copy", dossier_ids: [DOSSIER] },
      actor: { user_id: "user-1" },
    });
    expect(repo.eligibleByIds).toHaveBeenCalledWith(client, [DOSSIER]);
    expect(repo.update).toHaveBeenCalledWith(client, STORY, expect.objectContaining({
      executive_summary: "New approved copy",
      summary: "New approved copy",
      signed_off_by: null,
    }));
    expect(repo.replaceDossiers).toHaveBeenCalledWith(client, STORY, [DOSSIER]);
  });

  test("published stories must be unpublished before content or media changes", async () => {
    repo.get.mockResolvedValueOnce({ success_story_id: STORY, is_published: true });
    await expect(service.update({}, { id: STORY, patch: { title: "Changed" } }))
      .rejects.toMatchObject({ code: "LOCKED" });
  });

  test("eligible dossier SQL excludes financial columns and pages/searches", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/modules/sales/success_story/success_story.repo.js"), "utf8");
    expect(src).toContain("dossier_visible");
    expect(src).toContain("FINANCIALLY_PENDING");
    expect(src).toContain("LIMIT $${li} OFFSET $${oi}");
    expect(src).toContain("ILIKE");
    expect(src).not.toMatch(/\b(cost|margin|profit)\b/i);
  });
});

describe("F12 public story media", () => {
  test("consent defaults to anonymous including logo", () => {
    expect(publicStory.nameOf({ public_reference_consent: "NOT_ASKED", name: "Secret" })).toBe("Client anonymised");
    expect(publicStory.nameOf({ public_reference_consent: "ANONYMISED_ONLY", name: "Secret" })).toBe("Client anonymised");
    expect(publicStory.nameOf({ public_reference_consent: "NAMED", name: "Acme" })).toBe("Acme");
  });

  test("list emits a logo URL only for a verified bound image and NAMED consent", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [
      { slug: "named", title: "Named", public_reference_consent: "NAMED", name: "Acme", logo_allowed: true, client_logo_vault_id: MEDIA },
      { slug: "anon", title: "Anonymous", public_reference_consent: "ANONYMISED_ONLY", name: "Secret", logo_allowed: true, client_logo_vault_id: MEDIA },
    ] }) };
    const out = await publicStory.list(client);
    expect(out[0].client_logo_url).toContain(MEDIA);
    expect(out[1].client_logo_url).toBeNull();
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain("SUCCESS_STORY_MEDIA");
    expect(sql).toContain("public_media_entity_ref");
    expect(sql).toContain("public_media_role = 'CLIENT_LOGO'");
  });

  test("anonymous media requires exact publication, story binding, image type, role and logo consent", async () => {
    storage.get.mockResolvedValue(Buffer.from("image"));
    const client = { query: jest.fn().mockResolvedValue({ rows: [{
      doc_id: MEDIA, storage_path: "tenant/story.webp", public_media_content_type: "image/webp",
    }] }) };
    const out = await publicStory.media(client, MEDIA);
    expect(out.buffer.toString()).toBe("image");
    const sql = client.query.mock.calls[0][0];
    for (const condition of [
      "s.is_published = true", "SUCCESS_STORY_MEDIA", "public_media_scope = 'SUCCESS_STORY'",
      "public_media_content_type", "s.cover_vault_id = v.doc_id", "s.gallery_vault_ids",
      "cm.public_reference_consent = 'NAMED'",
    ]) expect(sql).toContain(condition);
  });

  test("an arbitrary or unbound vault document gets the same 404", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(publicStory.media(client, MEDIA)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(publicStory.media(client, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(storage.get).not.toHaveBeenCalled();
  });

  test("multi-file join and structured media fields exist", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../migrations/tenant/0694_sales_crm_f11_f12_success_stories.sql"), "utf8");
    for (const field of ["success_story_dossier", "executive_summary", "operations_execution", "gallery_vault_ids", "client_logo_vault_id"]) {
      expect(sql).toContain(field);
    }
  });
});
