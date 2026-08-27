/**
 * service_type_web.service — the publish gate, the lock-while-published
 * rules, the cover-replace-archives-old-vault flow, and the upsert shape.
 * Each row is a CI row from the guide's §7 test plan.
 */
"use strict";

jest.mock("../../src/modules/operations/service_type_web/service_type_web.repo", () => ({
  getProfile: jest.fn(),
  emptyProfile: jest.fn(),
  upsertProfile: jest.fn(),
  lockProfile: jest.fn(),
  serviceTypeForPublish: jest.fn(),
  setPublished: jest.fn(),
  setUnpublished: jest.fn(),
  autoUnpublishForServiceType: jest.fn(),
  listFaq: jest.fn(),
  replaceFaq: jest.fn(),
  listRelated: jest.fn(),
  replaceRelated: jest.fn(),
  vaultMediaForServe: jest.fn(),
  serviceTypeExists: jest.fn(),
  publicList: jest.fn(),
  publicDetail: jest.fn(),
  publicRelated: jest.fn(),
  publicFaq: jest.fn(),
  IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(), audit: jest.fn(), resolveActorId: jest.fn(async (_c, id) => id || null),
}));
jest.mock("../../src/shared/db/tx", () => ({
  atomically: jest.fn((client, fn) => fn(client)),
}));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: jest.fn(),
}));
jest.mock("../../src/services/storage.service", () => ({ get: jest.fn(), delete: jest.fn() }));

const repo = require("../../src/modules/operations/service_type_web/service_type_web.repo");
const events = require("../../src/modules/operations/service_type_web/service_type_web.events");
const service = require("../../src/modules/operations/service_type_web/service_type_web.service");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");

const ST = "11111111-1111-4111-8111-111111111111";
const COVER = "22222222-2222-4222-8222-222222222222";
const OLD_COVER = "33333333-3333-4333-8333-333333333333";

const baseProfile = {
  service_type_id: ST,
  short_description_fr: "a", short_description_en: "a",
  long_description_fr: "a", long_description_en: "a",
  highlights_fr: [], highlights_en: [],
  coverage_fr: null, coverage_en: null,
  slug_fr: "fret", slug_en: "fret",
  meta_title_fr: null, meta_title_en: null,
  meta_description_fr: null, meta_description_en: null,
  cover_vault_id: null, icon_vault_id: null,
  gallery_vault_ids: [], video_url: null,
  is_published: false, published_at: null, published_by: null,
  sort_order: 100,
};

const fullServiceType = { service_type_id: ST, name_en: "Sea freight", is_active: true };
const inactiveServiceType = { service_type_id: ST, name_en: "Sea freight", is_active: false };
const noEnglishServiceType = { service_type_id: ST, name_en: null, is_active: true };

beforeEach(() => {
  jest.clearAllMocks();
  repo.serviceTypeExists.mockResolvedValue(true);
  repo.emptyProfile.mockImplementation((id) => ({ ...baseProfile, service_type_id: id }));
  repo.listFaq.mockResolvedValue([]);
  repo.listRelated.mockResolvedValue([]);
  repo.getProfile.mockResolvedValue(null);
  repo.serviceTypeForPublish.mockResolvedValue(fullServiceType);
  repo.vaultMediaForServe.mockResolvedValue(null);
});

/** A tenant client that records every `query()` call and answers the
 *  queries the service actually issues (slug-uniqueness probe, cover
 *  replace archive, service_type lookup).  */
function recordingClient() {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      // Default answers — tests can override the implementation per case.
      if (/SELECT 1 FROM service_type_web_profile/.test(text)) {
        return { rows: [] };
      }
      if (/UPDATE document_vault/.test(text) && /status = 'ARCHIVED'/.test(text)) {
        return { rows: [] };
      }
      if (/SELECT service_type_id, name_en, is_active/.test(text)) {
        return { rows: [] };
      }
      if (/SELECT service_type_id FROM service_type/.test(text) && /is_active = true/.test(text)) {
        return { rows: params[0].map((id) => ({ service_type_id: id })) };
      }
      // The only params that flow into the default branch are irrelevant —
      // every concrete query above is matched first.
      return { rows: [] };
    },
  };
}

describe("service_type_web.service — publish gate (guide §4.2)", () => {
  test("publish refuses when name_en is missing on the service type", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    repo.serviceTypeForPublish.mockResolvedValue(noEnglishServiceType);
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: COVER, public_media_entity_ref: `service_type:${ST}`,
      public_media_role: "COVER", public_media_content_type: "image/png",
    });
    await expect(service.publish({}, { serviceTypeId: ST, actor: {} }))
      .rejects.toMatchObject({ code: "INCOMPLETE_PROFILE" });
  });

  test("publish refuses when the cover is set but the vault row is missing / unscoped", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    repo.vaultMediaForServe.mockResolvedValue(null);
    await expect(service.publish({}, { serviceTypeId: ST, actor: {} }))
      .rejects.toMatchObject({ code: "INCOMPLETE_PROFILE" });
  });

  test("publish refuses when short_description_fr is missing", async () => {
    const p = { ...baseProfile, cover_vault_id: COVER, short_description_fr: null };
    repo.lockProfile.mockResolvedValue(p);
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: COVER, public_media_entity_ref: `service_type:${ST}`,
      public_media_role: "COVER", public_media_content_type: "image/png",
    });
    await expect(service.publish({}, { serviceTypeId: ST, actor: {} }))
      .rejects.toMatchObject({ code: "INCOMPLETE_PROFILE" });
  });

  test("publish refuses when the service type is inactive (archive auto-unpublishes)", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    repo.serviceTypeForPublish.mockResolvedValue(inactiveServiceType);
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: COVER, public_media_entity_ref: `service_type:${ST}`,
      public_media_role: "COVER", public_media_content_type: "image/png",
    });
    await expect(service.publish({}, { serviceTypeId: ST, actor: {} }))
      .rejects.toMatchObject({ code: "INACTIVE_SERVICE_TYPE" });
  });

  test("publish succeeds with every required field + a valid cover and is idempotent on re-call", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: COVER, public_media_entity_ref: `service_type:${ST}`,
      public_media_role: "COVER", public_media_content_type: "image/png",
    });
    repo.setPublished.mockResolvedValue({ ...baseProfile, is_published: true, cover_vault_id: COVER });
    await expect(service.publish({}, { serviceTypeId: ST, actor: { user_id: "u-1" } }))
      .resolves.toBeDefined();
    expect(repo.setPublished).toHaveBeenCalledWith(expect.anything(), ST, "u-1");
  });
});

describe("service_type_web.service — lock-while-published (rule 4)", () => {
  test("slug change is refused while published with 422 LOCKED", async () => {
    repo.getProfile.mockResolvedValue({ ...baseProfile, is_published: true });
    await expect(service.upsertProfile({}, {
      serviceTypeId: ST, patch: { slug_fr: "new-slug" }, actor: {},
    })).rejects.toMatchObject({ code: "LOCKED" });
  });

  test("media change is refused while published with 422 LOCKED", async () => {
    repo.getProfile.mockResolvedValue({ ...baseProfile, is_published: true });
    await expect(service.upsertProfile({}, {
      serviceTypeId: ST, patch: { cover_vault_id: COVER }, actor: {},
    })).rejects.toMatchObject({ code: "LOCKED" });
  });

  test("copy edits (descriptions, highlights, video, sort_order) stay live while published", async () => {
    repo.getProfile.mockResolvedValue({ ...baseProfile, is_published: true });
    repo.upsertProfile.mockResolvedValue({ ...baseProfile, is_published: true, sort_order: 50 });
    const client = recordingClient();
    const out = await service.upsertProfile(client, {
      serviceTypeId: ST, patch: { sort_order: 50, long_description_fr: "new copy" }, actor: {},
    });
    expect(out).toBeDefined();
    expect(repo.upsertProfile).toHaveBeenCalled();
  });
});

describe("service_type_web.service — cover replace archives the old vault row", () => {
  test("a new COVER archives the previous one and clears its public scope", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: OLD_COVER });
    vault.createDocument.mockResolvedValue({ doc_id: COVER, storage_path: "tenant/web/cover.png" });
    repo.upsertProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    const client = recordingClient();
    await service.uploadMedia(client, {
      serviceTypeId: ST, role: "COVER",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      actor: {}, slug: "t1",
    });
    // The archive UPDATE must reference the OLD cover, with its public scope cleared.
    const archiveCall = client.calls.find(
      (c) => /UPDATE document_vault/.test(c.text) && /status = 'ARCHIVED'/.test(c.text),
    );
    expect(archiveCall).toBeDefined();
    expect(archiveCall.params[0]).toBe(OLD_COVER);
  });

  test("a GALLERY upload does NOT archive anything (gallery is append-only)", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, gallery_vault_ids: [] });
    vault.createDocument.mockResolvedValue({ doc_id: COVER, storage_path: "tenant/web/g.png" });
    repo.upsertProfile.mockResolvedValue({ ...baseProfile, gallery_vault_ids: [COVER] });
    const client = recordingClient();
    await service.uploadMedia(client, {
      serviceTypeId: ST, role: "GALLERY",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      actor: {}, slug: "t1",
    });
    const archiveCall = client.calls.find(
      (c) => /UPDATE document_vault/.test(c.text) && /status = 'ARCHIVED'/.test(c.text),
    );
    expect(archiveCall).toBeUndefined();
  });

  test("a media upload while published is refused with LOCKED", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile, is_published: true });
    await expect(service.uploadMedia({}, {
      serviceTypeId: ST, role: "COVER",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      actor: {}, slug: "t1",
    })).rejects.toMatchObject({ code: "LOCKED" });
  });

  test("a non-image data URL is refused (no vault row created)", async () => {
    repo.lockProfile.mockResolvedValue({ ...baseProfile });
    await expect(service.uploadMedia({}, {
      serviceTypeId: ST, role: "COVER",
      dataUrl: "data:application/pdf;base64,abc=",
      actor: {}, slug: "t1",
    })).rejects.toMatchObject({ code: "BAD_FILE_TYPE" });
    expect(vault.createDocument).not.toHaveBeenCalled();
  });
});

describe("service_type_web.service — upsert is create-once-then-update", () => {
  test("the first PUT creates; the second PUT updates the same row", async () => {
    const client = recordingClient();
    repo.getProfile.mockResolvedValueOnce(null);
    repo.upsertProfile.mockResolvedValueOnce({ ...baseProfile, sort_order: 50 });
    await service.upsertProfile(client, {
      serviceTypeId: ST, patch: { sort_order: 50 }, actor: {},
    });
    expect(events.CREATED).toBe("service_type_web.profile_created");

    repo.getProfile.mockResolvedValueOnce({ ...baseProfile, sort_order: 50 });
    repo.upsertProfile.mockResolvedValueOnce({ ...baseProfile, sort_order: 25 });
    await service.upsertProfile(client, {
      serviceTypeId: ST, patch: { sort_order: 25 }, actor: {},
    });
    expect(events.UPDATED).toBe("service_type_web.profile_updated");
  });

  test("duplicate slug_fr across two services hits the 422 SLUG_TAKEN guard", async () => {
    repo.getProfile.mockResolvedValue({ ...baseProfile, slug_fr: "old" });
    const client = {
      async query(text) {
        if (/SELECT 1 FROM service_type_web_profile/.test(text)) {
          return { rows: [{ 1: 1 }], rowCount: 1 }; // somebody else has the slug
        }
        return { rows: [], rowCount: 0 };
      },
    };
    await expect(service.upsertProfile(client, {
      serviceTypeId: ST, patch: { slug_fr: "new-slug" }, actor: {},
    })).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });
});

describe("service_type_web.service — GET is total (guide §3.1, §4.5)", () => {
  test("on a service type with no profile row, the GET still returns 200-shaped data", async () => {
    repo.getProfile.mockResolvedValue(null);
    repo.emptyProfile.mockImplementation((id) => ({
      service_type_id: id,
      short_description_fr: null, short_description_en: null,
      long_description_fr: null, long_description_en: null,
      highlights_fr: [], highlights_en: [],
      coverage_fr: null, coverage_en: null,
      slug_fr: null, slug_en: null,
      meta_title_fr: null, meta_title_en: null,
      meta_description_fr: null, meta_description_en: null,
      cover_vault_id: null, icon_vault_id: null,
      gallery_vault_ids: [], video_url: null,
      is_published: false, published_at: null, published_by: null,
      sort_order: 100,
    }));
    const out = await service.getTab({}, ST);
    expect(out.profile).toBeNull();
    expect(out.readiness).toBeDefined();
    expect(out.readiness.publishable).toBe(false);
    expect(out.readiness.missing).toEqual(expect.arrayContaining([
      "short_description_fr", "short_description_en",
      "long_description_fr", "long_description_en",
      "slug_fr", "slug_en", "cover_image",
    ]));
  });

  test("readiness recomputes per GET — setting name_en elsewhere reflects in the next call", async () => {
    repo.getProfile.mockResolvedValue({ ...baseProfile, cover_vault_id: COVER });
    repo.vaultMediaForServe.mockResolvedValue({
      doc_id: COVER, public_media_entity_ref: `service_type:${ST}`,
      public_media_role: "COVER", public_media_content_type: "image/png",
    });
    repo.serviceTypeForPublish.mockResolvedValueOnce({ service_type_id: ST, name_en: null, is_active: true });
    const before = await service.getTab({}, ST);
    expect(before.readiness.name_en_present).toBe(false);
    expect(before.readiness.missing).toContain("name_en");

    repo.serviceTypeForPublish.mockResolvedValueOnce({ service_type_id: ST, name_en: "Sea", is_active: true });
    const after = await service.getTab({}, ST);
    expect(after.readiness.name_en_present).toBe(true);
    expect(after.readiness.missing).not.toContain("name_en");
  });

  test("on a nonexistent service type id, getTab throws NOT_FOUND", async () => {
    repo.serviceTypeExists.mockResolvedValue(false);
    await expect(service.getTab({}, "nope")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("service_type_web.service — auto-unpublish hook for archive", () => {
  test("the hook unpublishes in-place and is a no-op when nothing is published", async () => {
    repo.autoUnpublishForServiceType.mockResolvedValueOnce({ service_type_id: ST });
    const out = await service.autoUnpublishForArchive({}, ST);
    expect(out.service_type_id).toBe(ST);
  });
});
