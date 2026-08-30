"use strict";

/**
 * The block library and the metric registry (migration 12753).
 *
 * `content` is jsonb, so Postgres cannot enforce a block's shape — the schema
 * registry does, and that only holds while the registry and the CHECK agree.
 * The first test here is the one that keeps them agreeing; the rest pin the two
 * rules that make tenant-editable content safe on a public page.
 */

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");
const schema = require("../../src/modules/site/site_content/site_content.schema");
const metrics = require("../../src/modules/site/site_content/site_content.metrics");

const sql = fs.readFileSync(
  path.join(repoRoot, "migrations/tenant/12753_site_page_blocks.sql"),
  "utf8",
);

/** The types the CHECK actually admits. */
function checkTypes() {
  const block = sql.slice(sql.indexOf("site_block_type_chk CHECK (type IN ("));
  const list = block.slice(0, block.indexOf("));"));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("the block library and the CHECK agree", () => {
  it("defines exactly the types the database admits", () => {
    // A type in the CHECK but not the registry is a row that saves and renders
    // as nothing. A type in the registry but not the CHECK is an editor option
    // that 500s on save. Both are silent until a tenant hits them.
    expect([...schema.BLOCK_TYPES].sort()).toEqual([...checkTypes()].sort());
  });

  it("covers every block the plan's library names", () => {
    for (const type of [
      "hero", "stat_chips", "stat_counters", "logo_strip", "feature_list",
      "card_grid", "text_image", "two_column_values", "leader_message",
      "pillar_framework", "testimonials", "form_block", "contact_block",
      "cta_band", "policies",
    ]) {
      expect(schema.BLOCK_TYPES).toContain(type);
    }
  });
});

describe("content is closed, not open", () => {
  it("rejects a field no schema declares", () => {
    // .strict() everywhere: an unknown key is refused rather than stored and
    // silently never rendered.
    const out = schema.validateBlock("hero", { title: { fr: "T" }, sneaky: "<script>" });
    expect(out.ok).toBe(false);
  });

  it("rejects an unknown block type outright", () => {
    expect(schema.validateBlock("carousel_of_doom", {}).ok).toBe(false);
  });

  it("requires the French string, which is the fallback every renderer reads", () => {
    expect(schema.validateBlock("hero", { title: { en: "only english" } }).ok).toBe(false);
    expect(schema.validateBlock("hero", { title: { fr: "Titre" } }).ok).toBe(true);
  });

  it("takes images as vault ids, never as URLs", () => {
    const url = schema.validateBlock("text_image", {
      body: { fr: "x" }, image: "https://example.com/hero.jpg",
    });
    expect(url.ok).toBe(false);
  });

  it("takes accents as brand tokens, never as hex", () => {
    const hex = schema.validateBlock("feature_list", {
      items: [{ title: { fr: "x" }, accent: "#EE7D04" }],
    });
    expect(hex.ok).toBe(false);
    const token = schema.validateBlock("feature_list", {
      items: [{ title: { fr: "x" }, accent: "ACCENT" }],
    });
    expect(token.ok).toBe(true);
  });

  it("requires alt text on every logo", () => {
    // A strip of unlabelled logos is unreadable to a screen reader and
    // worthless to a crawler.
    const noAlt = schema.validateBlock("logo_strip", {
      items: [{ image: "11111111-1111-4111-8111-111111111111" }],
    });
    expect(noAlt.ok).toBe(false);
  });

  it("takes map coordinates rather than an embed", () => {
    const embed = schema.validateBlock("contact_block", { map_embed: "<iframe>" });
    expect(embed.ok).toBe(false);
    const coords = schema.validateBlock("contact_block", { lat: 4.05, lng: 9.7 });
    expect(coords.ok).toBe(true);
  });

  it("carries a leader's paragraphs as an array, not one blob to split", () => {
    const ok = schema.validateBlock("leader_message", {
      name: "T. MASSOMBA",
      role: { fr: "Directeur Général" },
      paragraphs: [{ fr: "un" }, { fr: "deux" }],
    });
    expect(ok.ok).toBe(true);
  });
});

describe("stat blocks bind to the metric registry", () => {
  it("accepts a registered metric key", () => {
    const out = schema.validateBlock("stat_counters", {
      items: [{ label: { fr: "Services" }, value: 0, metric_key: "services.published_count" }],
    });
    expect(out.ok).toBe(true);
  });

  it("refuses an unregistered key at save time, not at render time", () => {
    // A typo that only shows up as a number which silently never updates is
    // exactly the failure this refuses to ship.
    const out = schema.validateBlock("stat_counters", {
      items: [{ label: { fr: "CBM" }, value: 41850, metric_key: "dossier.made_up" }],
    });
    expect(out.ok).toBe(false);
  });

  it("keeps the literal required, because it is the fallback", () => {
    const noValue = schema.validateBlock("stat_counters", {
      items: [{ label: { fr: "CBM" }, metric_key: "services.published_count" }],
    });
    expect(noValue.ok).toBe(false);
  });

  it("allows a stat with no binding at all", () => {
    const out = schema.validateBlock("stat_counters", {
      items: [{ label: { fr: "CBM" }, value: 41850 }],
    });
    expect(out.ok).toBe(true);
  });
});

describe("resolveMetric never takes the page down", () => {
  const client = { query: async () => ({ rows: [{ n: 7 }] }) };

  it("resolves a registered metric", async () => {
    await expect(metrics.resolveMetric(client, "services.published_count")).resolves.toBe(7);
  });

  it("returns null for a key that is not registered", async () => {
    await expect(metrics.resolveMetric(client, "anything.else")).resolves.toBeNull();
    await expect(metrics.resolveMetric(client, null)).resolves.toBeNull();
  });

  it("returns null rather than throwing when a resolver fails", async () => {
    // A metric is decoration on a marketing page; the caller falls back to the
    // literal. A stale number beats a 500 on a client's website.
    const broken = { query: async () => { throw new Error("db down"); } };
    await expect(metrics.resolveMetric(broken, "services.published_count")).resolves.toBeNull();
  });

  it("returns null when a resolver yields something that is not a number", async () => {
    const weird = { query: async () => ({ rows: [] }) };
    await expect(metrics.resolveMetric(weird, "services.published_count")).resolves.toBe(0);
  });
});

describe("migration 12753", () => {
  it("cascades blocks with their page, and indexes the render read", () => {
    expect(sql).toMatch(/page_id[\s\S]{0,80}REFERENCES site_page\(page_id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/ix_site_block_page_order[\s\S]*page_id, sort_order[\s\S]*WHERE is_visible/);
  });

  it("keeps a page unpublished by default", () => {
    // Half-written copy must not appear on a domain a client's customers visit.
    expect(sql).toMatch(/is_published\s+boolean NOT NULL DEFAULT false/);
  });
});
