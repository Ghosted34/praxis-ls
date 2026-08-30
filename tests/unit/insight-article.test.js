"use strict";

/**
 * Insights (WS5) — the module built to fix a specific set of faults on
 * smartls.cm's Kaizen Hub, each of which has a wrong version that looks right.
 *
 * The two worth reading first:
 *
 *   · **the filter bar is derived, never listed.** Theirs hardcodes four buttons
 *     over six tags in the data, so two articles are unreachable by any filter.
 *     That bug is invisible until somebody counts, and a hardcoded list can only
 *     ever regain it.
 *   · **an unpublished article and an unknown slug are the same 404.**
 *     Distinguishing them lets anyone confirm a draft exists at a guessed URL,
 *     which is how an unannounced piece leaks before its date.
 */

jest.mock("../../src/modules/content/insight/insight.repo");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));

const repo = require("../../src/modules/content/insight/insight.repo");
const service = require("../../src/modules/content/insight/insight.service");
const { schemas } = require("../../src/modules/content/insight/insight.validator");

const client = {};
const row = (over = {}) => ({
  insight_article_id: "a1",
  slug_fr: "la-douane-en-2026",
  slug_en: "customs-in-2026",
  title_fr: "La douane en 2026",
  title_en: "Customs in 2026",
  excerpt_fr: "Ce qui change.",
  excerpt_en: "What changes.",
  body_fr: "<p>Texte</p>",
  body_en: "<p>Text</p>",
  tags: ["strategy", "operations"],
  cover_vault_id: "c1",
  author_user_id: "u1",
  author_name: "Joseph Moukoko",
  author_title: "Head of Operations",
  author_avatar_ref: "avatars/jm.png",
  is_published: true,
  published_at: "2026-02-01T09:00:00.000Z",
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("the public card", () => {
  it("carries the excerpt and the date their cards do not", () => {
    // Theirs shows title + author only, and no date anywhere on the site. A
    // knowledge hub that cannot show recency is not credible.
    const card = service.publicCard(row());
    expect(card.excerpt_fr).toBe("Ce qui change.");
    expect(card.published_at).toBe("2026-02-01T09:00:00.000Z");
    expect(card.tags).toEqual(["strategy", "operations"]);
  });

  it("names the author from the ERP, with their job title", () => {
    // Their author names live inside translation keys — a name is not
    // translatable content, and these five people are staff we already hold.
    expect(service.publicCard(row()).author).toEqual({
      name: "Joseph Moukoko",
      title: "Head of Operations",
      avatar_ref: "avatars/jm.png",
    });
  });

  it("is unattributed rather than blank when the author has left", () => {
    // ON DELETE SET NULL: the article outlives the colleague. A byline of ""
    // would read as a name nobody typed.
    expect(service.publicCard(row({ author_user_id: null, author_name: null })).author).toBeNull();
  });

  it("never leaks a column from app_user", () => {
    // Built explicitly rather than by deleting: app_user carries a password
    // hash and a TOTP secret, and a denylist fails OPEN when that table grows.
    const json = JSON.stringify(service.publicCard(row({
      password_hash: "$argon2id$x", totp_secret_enc: "s3cret",
    })));
    expect(json).not.toContain("argon2");
    expect(json).not.toContain("totp");
    expect(json).not.toContain("s3cret");
  });

  it("keeps no body on a card", () => {
    // Nine cards carrying nine article bodies is an index page that weighs more
    // than every article on it.
    expect(service.publicCard(row())).not.toHaveProperty("body_fr");
  });
});

describe("the index", () => {
  beforeEach(() => {
    repo.list.mockResolvedValue([row()]);
    repo.count.mockResolvedValue(1);
    repo.tagsInUse.mockResolvedValue([
      { tag: "strategy", count: 3 },
      { tag: "sustainability", count: 1 },
    ]);
  });

  it("ships the filter bar WITH the page, derived from the tags in use", async () => {
    // The fix for their bug: a tag cannot exist in the data without a way to
    // reach it, and a tag nobody uses cannot linger in the bar.
    const out = await service.listPublic(client);
    expect(out.tags).toEqual([
      { tag: "strategy", count: 3 },
      { tag: "sustainability", count: 1 },
    ]);
  });

  it("computes the tag bar over EVERY published article, not the filtered set", async () => {
    // A visitor narrowed to "strategy" still needs the other tags in front of
    // them, or the only way back is the browser's Back button.
    await service.listPublic(client, { tag: "strategy" });
    expect(repo.tagsInUse).toHaveBeenCalledWith(client, { publishedOnly: true });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ tag: "strategy" }));
  });

  it("asks only for published articles", async () => {
    await service.listPublic(client);
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ publishedOnly: true }));
    expect(repo.count).toHaveBeenCalledWith(client, expect.objectContaining({ publishedOnly: true }));
  });

  it("reports has_more rather than leaving the browser to derive it", async () => {
    // The browser would have to know perPage, and a rounding disagreement is a
    // "next" button that leads to an empty page.
    repo.count.mockResolvedValue(30);
    const out = await service.listPublic(client, { page: 1, perPage: 9 });
    expect(out.has_more).toBe(true);
    expect(out.total).toBe(30);
  });

  it("knows when it has reached the end", async () => {
    repo.count.mockResolvedValue(1);
    expect((await service.listPublic(client, { page: 1, perPage: 9 })).has_more).toBe(false);
  });

  it("offsets by the page it was asked for", async () => {
    await service.listPublic(client, { page: 3, perPage: 9 });
    expect(repo.list).toHaveBeenCalledWith(client, expect.objectContaining({ limit: 9, offset: 18 }));
  });
});

describe("the article read", () => {
  it("404s an unpublished slug exactly as it 404s an unknown one", async () => {
    // Distinguishing them confirms a draft exists at a guessed URL.
    repo.getBySlug.mockResolvedValue(null);
    await expect(service.getPublic(client, "secret-piece")).rejects.toMatchObject({ status: 404 });
    expect(repo.getBySlug).toHaveBeenCalledWith(client, "secret-piece", { publishedOnly: true });
  });

  it("returns the body a reader came for", async () => {
    repo.getBySlug.mockResolvedValue(row());
    const out = await service.getPublic(client, "la-douane-en-2026");
    expect(out.body_fr).toBe("<p>Texte</p>");
    expect(out.title_en).toBe("Customs in 2026");
  });
});

describe("slugs", () => {
  it("refuses one already in use by another article", async () => {
    repo.slugTaken.mockResolvedValue(true);
    await expect(service.create(client, { patch: { title_fr: "T", slug_fr: "taken" } }))
      .rejects.toMatchObject({ status: 422, code: "SLUG_TAKEN" });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("checks a French slug against BOTH columns", async () => {
    // getBySlug matches either, so a French slug colliding with another
    // article's English slug makes one of the two unreachable — and the unique
    // indexes are per-column and cannot see it.
    repo.slugTaken.mockResolvedValue(false);
    repo.insert.mockResolvedValue(row());
    await service.create(client, { patch: { title_fr: "T", slug_fr: "a", slug_en: "b" } });
    expect(repo.slugTaken).toHaveBeenCalledWith(client, "a", null);
    expect(repo.slugTaken).toHaveBeenCalledWith(client, "b", null);
  });

  it("refuses one article using the same slug for both languages", async () => {
    // Legal in the database — two different columns — and it would give the two
    // languages one URL, which is the thing per-language URLs exist to avoid.
    repo.slugTaken.mockResolvedValue(false);
    await expect(service.create(client, { patch: { title_fr: "T", slug_fr: "same", slug_en: "same" } }))
      .rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });

  it("accepts lowercase hyphenated slugs and refuses everything else", () => {
    const ok = (v) => schemas.create.safeParse({ title_fr: "T", slug_fr: v }).success;
    expect(ok("la-douane-en-2026")).toBe(true);
    expect(ok("La-Douane")).toBe(false);
    expect(ok("la douane")).toBe(false);
    expect(ok("la--douane")).toBe(false);
    expect(ok("-douane")).toBe(false);
  });
});

describe("tags are normalised on the way in", () => {
  it("lowercases and de-duplicates, so the derived bar has one entry each", () => {
    // Otherwise "Strategy" and "strategy" appear as two filters in a bar that
    // is built from the tags in use.
    const parsed = schemas.create.parse({ title_fr: "T", tags: ["Strategy", "strategy", " Operations "] });
    expect(parsed.tags).toEqual(["strategy", "operations"]);
  });
});

describe("publishing", () => {
  it("refuses an article with no body", async () => {
    // A published row with no body is a URL in the sitemap that renders a title
    // over white space, found by a reader rather than by the writer.
    repo.get.mockResolvedValue(row({ body_fr: "", body_en: null, is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: true }))
      .rejects.toMatchObject({ status: 422, code: "EMPTY_ARTICLE" });
    expect(repo.setPublished).not.toHaveBeenCalled();
  });

  it("refuses an article with no slug", async () => {
    repo.get.mockResolvedValue(row({ slug_fr: null, slug_en: null, is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: true }))
      .rejects.toMatchObject({ code: "NO_SLUG" });
  });

  it("publishes one that has both", async () => {
    repo.get.mockResolvedValue(row({ is_published: false }));
    repo.setPublished.mockResolvedValue(row());
    await service.setPublished(client, { id: "a1", published: true, actor: { user_id: "u9" } });
    expect(repo.setPublished).toHaveBeenCalledWith(client, "a1", "u9", true);
  });

  it("never blocks an unpublish", async () => {
    // Taking something down is always allowed, whatever state it is in.
    repo.get.mockResolvedValue(row({ body_fr: "", slug_fr: null, slug_en: null }));
    repo.setPublished.mockResolvedValue(row({ is_published: false }));
    await expect(service.setPublished(client, { id: "a1", published: false })).resolves.toBeTruthy();
  });

  it("refuses to delete an article while it is live", async () => {
    // The URL is in search results and possibly linked from somewhere we do not
    // control.
    repo.get.mockResolvedValue(row({ is_published: true }));
    await expect(service.remove(client, { id: "a1" }))
      .rejects.toMatchObject({ status: 422, code: "PUBLISHED" });
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
