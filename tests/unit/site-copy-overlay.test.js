"use strict";

/**
 * The copy overlay — a tenant's wording for the sentences the APP prints.
 *
 * The repo is mocked, as in `site-content-service.test.js`: every behaviour
 * pinned here is a decision the service makes about rows it was handed, not a
 * query. The catalogue is REAL — it is the allow-list, and a stubbed one would
 * let this suite pass on an implementation that accepted any key at all, which
 * is the single thing these tests exist to prevent.
 */

jest.mock("../../src/modules/site/site_content/site_content.repo");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));

const repo = require("../../src/modules/site/site_content/site_content.repo");
const service = require("../../src/modules/site/site_content/site_content.service");
const schema = require("../../src/modules/site/site_content/site_content.schema");
const catalogue = require("../../packages/shared/data/site-copy.generated");

const client = {};
const block = (items) => ({ content: { items } });
const item = (key, fr, en) => ({ key, value: en === undefined ? { fr } : { fr, en } });

beforeEach(() => jest.clearAllMocks());

describe("the catalogue", () => {
  it("covers the strings a tenant would actually go looking for", () => {
    // The worked example from the report that prompted this: the Our-work
    // page's headline and its lead, which were the tenant's claim about the
    // tenant's business in words nobody at the tenant chose.
    for (const key of [
      "site.portfolioPage.titleMain",
      "site.portfolioPage.titleAccent",
      "site.portfolioPage.sub",
      "site.portfolioPage.empty",
    ]) {
      expect(catalogue.isSiteCopyKey(key)).toBe(true);
    }
  });

  it("is scoped to the public site and nothing else", () => {
    // `errors.*`, `states.*` and `portal.*` are the failure sentences and the
    // vocabulary the client portal shares with the ERP. A tenant rewriting
    // "Your session has expired" is not white-labelling, it is editing an
    // error message the support desk relies on reading back.
    for (const key of catalogue.siteCopyKeys()) {
      expect(key.startsWith("site.")).toBe(true);
    }
  });

  it("gives every key both languages and a section a human can read", () => {
    const sections = new Set(catalogue.SITE_COPY_SECTIONS.map((s) => s.key));
    for (const [key, section, label, en, fr] of catalogue.SITE_COPY_ENTRIES) {
      expect(sections.has(section)).toBe(true);
      expect(label.length).toBeGreaterThan(0);
      expect(typeof en).toBe("string");
      // FR is the half every renderer falls back to, so a key with no French
      // default would be a row a tenant cannot meaningfully be shown.
      expect(fr.length).toBeGreaterThan(0);
      expect(key.startsWith(`site.${section}.`)).toBe(true);
    }
  });
});

describe("the write path", () => {
  it("refuses a key the catalogue does not know", () => {
    const out = schema.validateBlock("copy_overrides", {
      items: [item("site.portfolioPage.nope", "x")],
    });
    expect(out.ok).toBe(false);
  });

  it("refuses an override with no French", () => {
    const out = schema.validateBlock("copy_overrides", {
      items: [{ key: "site.portfolioPage.sub", value: { en: "English only" } }],
    });
    expect(out.ok).toBe(false);
  });

  it("refuses markup-bearing keys reaching outside site.*", () => {
    for (const key of ["errors.loadFailed", "portal.title", "__proto__", "strings.Close"]) {
      const out = schema.validateBlock("copy_overrides", { items: [item(key, "x")] });
      expect(out.ok).toBe(false);
    }
  });
});

describe("getPublicCopy", () => {
  it("nests a dotted key into the tree i18next merges", async () => {
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([item("site.portfolioPage.titleMain", "Nos", "Reference")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out).toEqual({
      en: { site: { portfolioPage: { titleMain: "Reference" } } },
      fr: { site: { portfolioPage: { titleMain: "Nos" } } },
    });
  });

  it("falls English back to the tenant's French, not to ours", async () => {
    // FR is required and EN optional across this whole schema, so a tenant who
    // wrote only French said something deliberate about every language their
    // site is read in. A heading half theirs and half ours is the one outcome
    // nobody would choose on purpose.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([item("site.portfolioPage.sub", "Dans nos mots.")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out.en.site.portfolioPage.sub).toBe("Dans nos mots.");
    expect(out.fr.site.portfolioPage.sub).toBe("Dans nos mots.");
  });

  it("drops a key retired from the dictionary since it was written", async () => {
    // The row was valid when it was saved; the catalogue is a build artefact
    // and the row is data. Re-checking on read is what makes the shipped
    // sentence come back on its own rather than leaving a dead override in a
    // table nobody can see.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([
        item("site.retired.heading", "Vieux"),
        item("site.portfolioPage.sub", "Dans nos mots."),
      ]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out.fr.site.retired).toBeUndefined();
    expect(out.fr.site.portfolioPage.sub).toBe("Dans nos mots.");
  });

  it("drops an override with an empty French rather than blanking the sentence", async () => {
    // An empty string would REPLACE the shipped heading with nothing, which on
    // a hero is a blank page rather than a fallback.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([item("site.portfolioPage.sub", "", "")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out).toEqual({ en: {}, fr: {} });
  });

  it("answers an empty overlay for a tenant who has overridden nothing", async () => {
    // Every tenant, on day one. The site reads exactly as it shipped and the
    // renderer draws nothing differently — no 404, no error state.
    repo.listPublishedCopyOverrides.mockResolvedValue([]);
    expect(await service.getPublicCopy(client)).toEqual({ en: {}, fr: {} });
  });

  it("survives a malformed row without taking the public site down", async () => {
    repo.listPublishedCopyOverrides.mockResolvedValue([
      { content: null },
      { content: { items: "not an array" } },
      block([null, { key: 42 }, { key: "site.portfolioPage.sub" }]),
      block([item("site.portfolioPage.sub", "Dans nos mots.")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out.fr.site.portfolioPage.sub).toBe("Dans nos mots.");
  });

  it("cannot be made to write through the prototype chain", async () => {
    // CodeQL flagged the recursive assignment in `setPath`, and it was right to:
    // the catalogue makes `__proto__` unreachable TODAY, which is a fact about
    // the only caller rather than about the function. A row is data and this
    // one is the shape an attacker would send if the allow-list ever moved.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([
        item("__proto__.polluted", "yes"),
        item("site.__proto__.polluted", "yes"),
        item("constructor.prototype.polluted", "yes"),
        item("site.portfolioPage.sub", "Dans nos mots."),
      ]),
    ]);
    const out = await service.getPublicCopy(client);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    // …and the legitimate override in the same block still lands.
    expect(out.fr.site.portfolioPage.sub).toBe("Dans nos mots.");
  });

  it("serialises to the same JSON despite null-prototype nodes", async () => {
    // The wire format is the contract i18next's addResourceBundle consumes.
    // Object.create(null) is invisible to JSON.stringify, and this pins that —
    // a future refactor to Map or a class would not be.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([item("site.portfolioPage.titleMain", "Nos", "Reference")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(JSON.parse(JSON.stringify(out))).toEqual({
      en: { site: { portfolioPage: { titleMain: "Reference" } } },
      fr: { site: { portfolioPage: { titleMain: "Nos" } } },
    });
  });

  it("lets the last published page win when two override one key", async () => {
    // The repo orders by the page's own nav order, so this is at least stable
    // between requests. The editor writes one block on one page, so it is a
    // tie-break rather than a policy.
    repo.listPublishedCopyOverrides.mockResolvedValue([
      block([item("site.footer.legal", "Premier")]),
      block([item("site.footer.legal", "Dernier")]),
    ]);
    const out = await service.getPublicCopy(client);
    expect(out.fr.site.footer.legal).toBe("Dernier");
  });
});

describe("copyCatalogue", () => {
  it("hands the editor every key with both shipped defaults", () => {
    const out = service.copyCatalogue();
    expect(out.entries).toHaveLength(catalogue.SITE_COPY_ENTRIES.length);
    const row = out.entries.find((e) => e.key === "site.portfolioPage.sub");
    expect(row.default_en).toBe("Operations we have run, in our own words.");
    expect(row.section).toBe("portfolioPage");
    expect(out.sections.find((s) => s.key === "portfolioPage").pages).toContain("Our work");
  });
});
