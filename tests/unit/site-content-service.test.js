"use strict";

/**
 * Pages, blocks, and the metric resolution that makes a stat true.
 *
 * The repo is mocked: every behaviour worth pinning here is a decision the
 * service makes, not a query. The ones that matter most are the two that reach
 * a visitor — a metric that fails must leave the literal standing, and an
 * unpublished page must not render.
 */

jest.mock("../../src/modules/site/site_content/site_content.repo");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));
// The service destructures resolveMetric at require time, so a spy on the
// module object would never be reached. isMetricKey stays REAL: the block
// schema calls it at load, and a stubbed one would let invalid metric keys
// through the very validation another test here relies on.
jest.mock("../../src/modules/site/site_content/site_content.metrics", () => ({
  ...jest.requireActual("../../src/modules/site/site_content/site_content.metrics"),
  resolveMetric: jest.fn(),
}));

const repo = require("../../src/modules/site/site_content/site_content.repo");
const metrics = require("../../src/modules/site/site_content/site_content.metrics");
const service = require("../../src/modules/site/site_content/site_content.service");

const client = {};
const page = (over = {}) => ({
  page_id: "p1", key: "home", title_fr: "Accueil", is_published: true, ...over,
});
const statBlock = (items) => ({
  block_id: "b1", type: "stat_counters", is_visible: true, content: { items },
});

beforeEach(() => jest.clearAllMocks());

describe("metric resolution", () => {
  it("resolves each distinct metric once, however many blocks name it", async () => {
    // A tenant may repeat a headline number lower down the page. That must not
    // run the query twice on one render.
    metrics.resolveMetric.mockResolvedValue(9);
    const blocks = [
      statBlock([{ label: { fr: "a" }, value: 1, metric_key: "clients.served_count" }]),
      statBlock([
        { label: { fr: "b" }, value: 2, metric_key: "clients.served_count" },
        { label: { fr: "c" }, value: 3, metric_key: "dossiers.completed_count" },
      ]),
    ];
    const resolved = await service.resolveMetricsFor(client, blocks);
    expect(metrics.resolveMetric).toHaveBeenCalledTimes(2);
    expect(resolved.get("clients.served_count")).toBe(9);
  });

  it("asks for nothing when no block binds a metric", async () => {
    const resolved = await service.resolveMetricsFor(client, [
      statBlock([{ label: { fr: "a" }, value: 1 }]),
      { type: "hero", content: {} },
    ]);
    expect(metrics.resolveMetric).not.toHaveBeenCalled();
    expect(resolved.size).toBe(0);
  });

  it("overwrites the literal with the live value, and hides the key", async () => {
    // metric_key names an internal query; it tells a visitor nothing.
    const out = service.applyMetrics(
      statBlock([{ label: { fr: "CBM" }, value: 41850, metric_key: "dossiers.volume_cbm_total" }]),
      new Map([["dossiers.volume_cbm_total", 52310]]),
    );
    expect(out.content.items[0].value).toBe(52310);
    expect(out.content.items[0]).not.toHaveProperty("metric_key");
  });

  it("leaves the literal standing when the metric did not resolve", async () => {
    // The whole point of keeping the literal. A stale number beats a blank.
    const out = service.applyMetrics(
      statBlock([{ label: { fr: "CBM" }, value: 41850, metric_key: "dossiers.volume_cbm_total" }]),
      new Map(),
    );
    expect(out.content.items[0].value).toBe(41850);
    expect(out.content.items[0]).not.toHaveProperty("metric_key");
  });

  it("leaves a zero from the ERP as zero, not as the literal", async () => {
    // A new tenant genuinely has 0. Falling back here would advertise work
    // they have not done — which is why the map holds only resolved values and
    // 0 is one of them.
    const out = service.applyMetrics(
      statBlock([{ label: { fr: "Files" }, value: 999, metric_key: "dossiers.completed_count" }]),
      new Map([["dossiers.completed_count", 0]]),
    );
    expect(out.content.items[0].value).toBe(0);
  });

  it("touches nothing on a block that is not a stat block", () => {
    const hero = { type: "hero", content: { title: { fr: "T" } } };
    expect(service.applyMetrics(hero, new Map([["x", 1]]))).toBe(hero);
  });
});

describe("the public read", () => {
  it("404s an unpublished page rather than rendering an empty shell", async () => {
    // publishedOnly is what the repo is asked for; a miss is a 404.
    repo.getPageByKey.mockResolvedValue(null);
    await expect(service.getPublicPage(client, "about")).rejects.toMatchObject({ status: 404 });
    expect(repo.getPageByKey).toHaveBeenCalledWith(client, "about", { publishedOnly: true });
  });

  it("asks for visible blocks only", async () => {
    repo.getPageByKey.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue([]);
    await service.getPublicPage(client, "home");
    expect(repo.listBlocks).toHaveBeenCalledWith(client, "p1", { visibleOnly: true });
  });

  it("returns blocks stripped to what a renderer needs", async () => {
    repo.getPageByKey.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue([
      { block_id: "b1", type: "hero", is_visible: true, sort_order: 10, content: { title: { fr: "T" } } },
    ]);
    const out = await service.getPublicPage(client, "home");
    expect(out.blocks[0]).toEqual({ block_id: "b1", type: "hero", content: { title: { fr: "T" } } });
    expect(out.key).toBe("home");
  });

  it("lists only published pages in the nav", async () => {
    repo.listPages.mockResolvedValue([
      page({ key: "home", is_published: true }),
      page({ page_id: "p2", key: "draft", is_published: false }),
    ]);
    const out = await service.listPublicPages(client);
    expect(out.map((p) => p.key)).toEqual(["home"]);
  });
});

describe("publishing", () => {
  it("refuses a page with no visible blocks", async () => {
    // Publishing it would put a header and a footer around nothing on a
    // client's domain.
    repo.getPage.mockResolvedValue(page({ is_published: false }));
    repo.listBlocks.mockResolvedValue([]);
    await expect(service.setPublished(client, { pageId: "p1", published: true }))
      .rejects.toMatchObject({ status: 422, code: "EMPTY_PAGE" });
    expect(repo.setPublished).not.toHaveBeenCalled();
  });

  it("publishes a page that has content", async () => {
    repo.getPage.mockResolvedValue(page({ is_published: false }));
    repo.listBlocks.mockResolvedValue([{ block_id: "b1" }]);
    repo.setPublished.mockResolvedValue(page());
    await service.setPublished(client, { pageId: "p1", published: true, actor: { user_id: "u1" } });
    expect(repo.setPublished).toHaveBeenCalledWith(client, "p1", "u1", true);
  });

  it("never blocks an unpublish", async () => {
    // Taking something down is always allowed, whatever state it is in.
    repo.getPage.mockResolvedValue(page());
    repo.setPublished.mockResolvedValue(page({ is_published: false }));
    await service.setPublished(client, { pageId: "p1", published: false });
    expect(repo.listBlocks).not.toHaveBeenCalled();
  });

  it("refuses to delete a page while it is live", async () => {
    // A live URL is in search results and possibly on printed material.
    repo.getPage.mockResolvedValue(page({ is_published: true }));
    await expect(service.deletePage(client, { pageId: "p1" }))
      .rejects.toMatchObject({ status: 422, code: "PUBLISHED" });
    expect(repo.deletePage).not.toHaveBeenCalled();
  });
});

describe("block writes are validated against the type", () => {
  it("refuses content that does not fit the block's schema", async () => {
    repo.getPage.mockResolvedValue(page());
    await expect(service.createBlock(client, {
      pageId: "p1", patch: { type: "hero", content: { title: { en: "no french" } } },
    })).rejects.toMatchObject({ status: 422 });
    expect(repo.createBlock).not.toHaveBeenCalled();
  });

  it("validates an update against the block's EXISTING type", async () => {
    // Type is fixed at creation; content shaped for another type must not slip
    // through by naming one.
    repo.getBlock.mockResolvedValue({ block_id: "b1", type: "hero" });
    await expect(service.updateBlock(client, {
      blockId: "b1", patch: { content: { form: "CONTACT" } },
    })).rejects.toMatchObject({ status: 422 });
  });

  it("stores content the schema accepts", async () => {
    repo.getPage.mockResolvedValue(page());
    repo.createBlock.mockResolvedValue({ block_id: "b9" });
    await service.createBlock(client, {
      pageId: "p1", patch: { type: "cta_band", content: { title: { fr: "Parlons-en" } } },
    });
    expect(repo.createBlock).toHaveBeenCalledWith(client, "p1", expect.objectContaining({
      type: "cta_band", content: { title: { fr: "Parlons-en" } },
    }));
  });

  it("lets a block be hidden without resending its content", async () => {
    repo.getBlock.mockResolvedValue({ block_id: "b1", type: "hero" });
    repo.updateBlock.mockResolvedValue({ block_id: "b1", is_visible: false });
    await service.updateBlock(client, { blockId: "b1", patch: { is_visible: false } });
    expect(repo.updateBlock).toHaveBeenCalledWith(client, "b1", { is_visible: false });
  });
});

describe("reordering is all or nothing", () => {
  const onPage = [{ block_id: "a" }, { block_id: "b" }, { block_id: "c" }];

  it("refuses a partial list", async () => {
    // Omitted blocks would keep their old positions, interleaved with the new
    // ones in a way the caller neither asked for nor can predict.
    repo.getPage.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue(onPage);
    await expect(service.reorderBlocks(client, { pageId: "p1", orderedIds: ["a", "b"] }))
      .rejects.toMatchObject({ status: 422 });
    expect(repo.reorderBlocks).not.toHaveBeenCalled();
  });

  it("refuses duplicates", async () => {
    repo.getPage.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue(onPage);
    await expect(service.reorderBlocks(client, { pageId: "p1", orderedIds: ["a", "a", "b"] }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("refuses an id that belongs to another page", async () => {
    repo.getPage.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue(onPage);
    await expect(service.reorderBlocks(client, { pageId: "p1", orderedIds: ["a", "b", "zzz"] }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("accepts the whole page, exactly once each", async () => {
    repo.getPage.mockResolvedValue(page());
    repo.listBlocks.mockResolvedValue(onPage);
    repo.reorderBlocks.mockResolvedValue(3);
    const out = await service.reorderBlocks(client, { pageId: "p1", orderedIds: ["c", "a", "b"] });
    expect(out).toEqual({ reordered: 3 });
    expect(repo.reorderBlocks).toHaveBeenCalledWith(client, "p1", ["c", "a", "b"]);
  });
});
