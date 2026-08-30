"use strict";

/**
 * Structured data, and the host that must never be indexed.
 *
 * `doc/PUBLIC_WEB_PLAN.md` §3.7 asks for both, and both fail QUIETLY when they
 * are wrong: a malformed JobPosting is simply never picked up by Google Jobs,
 * and a staging host with no `noindex` competes with production for months
 * before anyone notices. Neither shows up in a browser, so neither is caught by
 * looking at the page.
 *
 * The module reads SEO_NOINDEX_HOSTS at load, so the variable is set before the
 * require rather than inside a test — which is also the honest shape: this is
 * deployment configuration, not something a request can change.
 */

process.env.SEO_NOINDEX_HOSTS = "staging.smartls.cm, preview.example.com";

jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async () => null,
  withTenantConnection: async () => null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));

const head = require("../../src/shared/http/public-head");

const BRANDING = { name: "Smart Logistics", logoUrl: "/media/logo.png" };
const ORIGIN = "https://smartls.cm";

const vacancy = (over = {}) => ({
  title: "Operations Officer",
  description: "<p>Run the import desk.</p>",
  published_at: "2026-01-02T00:00:00.000Z",
  closes_on: "2026-03-01",
  employment_type: "FULL_TIME",
  work_mode: "ONSITE",
  location_city: "Douala",
  location_state: "Littoral",
  location_country: "CM",
  salary_min: 500000,
  salary_max: 800000,
  salary_currency: "XAF",
  skills_required: ["CAMCIS", "Customs"],
  experience_years_min: 3,
  ...over,
});

describe("the staging host", () => {
  it("is recognised whatever port it arrives on", () => {
    expect(head.isNoindexHost("staging.smartls.cm")).toBe(true);
    expect(head.isNoindexHost("staging.smartls.cm:8443")).toBe(true);
    expect(head.isNoindexHost("STAGING.SMARTLS.CM")).toBe(true);
  });

  it("does not catch production by accident", () => {
    // The failure that would be worst here: a rule broad enough to noindex the
    // real site. `smartls.cm` is a SUFFIX of the staging host.
    expect(head.isNoindexHost("smartls.cm")).toBe(false);
    expect(head.isNoindexHost("www.smartls.cm")).toBe(false);
  });

  it("reads more than one host from the list, trimming as it goes", () => {
    expect(head.isNoindexHost("preview.example.com")).toBe(true);
  });

  it("refuses the whole crawl in robots.txt", () => {
    // Belt to the meta tag's braces. This stops the crawl; the tag is what
    // removes a URL already indexed from being linked elsewhere.
    const txt = head.robots(ORIGIN, true, "/", "staging.smartls.cm");
    expect(txt).toContain("Disallow: /");
    expect(txt).not.toContain("Sitemap:");
  });

  it("leaves a production host's robots.txt alone", () => {
    const txt = head.robots(ORIGIN, true, "/public", "smartls.cm");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap:");
  });
});

describe("the JSON-LD script block", () => {
  it("cannot be broken out of by a title containing a closing tag", () => {
    // The hazard an HTML-attribute escaper does not cover: `</script>` inside a
    // script block ends it, and everything after is parsed as markup.
    const out = head.ldScript({ name: "</script><img onerror=alert(1)>" });
    expect(out).not.toContain("</script><img");
    expect(out).toContain("\\u003c/script\\u003e");
    // Exactly one closing tag: the real one.
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it("escapes an ampersand as JSON, not as HTML", () => {
    // `&amp;` would be printed literally into the JSON and read back wrong.
    const out = head.ldScript({ name: "Freight & Customs" });
    expect(out).not.toContain("&amp;");
    expect(JSON.parse(out.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")).name)
      .toBe("Freight & Customs");
  });

  it("emits nothing for nothing", () => {
    expect(head.ldScript(null)).toBeNull();
  });
});

describe("Organization", () => {
  it("names the tenant and links its logo absolutely", () => {
    // A card is rendered by a server elsewhere with no idea what this page's
    // origin was.
    const ld = head.organizationLd(BRANDING, ORIGIN);
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("Smart Logistics");
    expect(ld.logo).toBe("https://smartls.cm/media/logo.png");
  });

  it("is absent rather than anonymous when branding has no name", () => {
    expect(head.organizationLd({}, ORIGIN)).toBeNull();
    expect(head.organizationLd(null, ORIGIN)).toBeNull();
  });
});

describe("JobPosting", () => {
  it("carries the four fields Google requires", () => {
    // A posting missing any of these is not rejected loudly — it simply never
    // appears, which is the failure this test exists for.
    const ld = head.jobPostingLd(vacancy(), ORIGIN, BRANDING);
    expect(ld["@type"]).toBe("JobPosting");
    expect(ld.title).toBe("Operations Officer");
    expect(ld.description).toBeTruthy();
    expect(ld.datePosted).toBe("2026-01-02T00:00:00.000Z");
    expect(ld.hiringOrganization.name).toBe("Smart Logistics");
  });

  it("sends the full description, not the card summary", () => {
    // A 200-character teaser is a listing that reads thin next to every
    // competitor's.
    const ld = head.jobPostingLd(vacancy(), ORIGIN, BRANDING);
    expect(ld.description).toBe("<p>Run the import desk.</p>");
  });

  it("publishes a salary band when the recruiter left it visible", () => {
    const ld = head.jobPostingLd(vacancy(), ORIGIN, BRANDING);
    expect(ld.baseSalary.currency).toBe("XAF");
    expect(ld.baseSalary.value.minValue).toBe(500000);
    expect(ld.baseSalary.value.maxValue).toBe(800000);
  });

  it("publishes NO salary when the recruiter hid it", () => {
    // The one place a leak cannot be retracted from. `publicVacancy` omits the
    // numbers; inferring a band from anything else would republish exactly what
    // was withheld.
    const ld = head.jobPostingLd(
      vacancy({ salary_hidden: true, salary_min: undefined, salary_max: undefined }),
      ORIGIN,
      BRANDING,
    );
    expect(ld).not.toHaveProperty("baseSalary");
    expect(JSON.stringify(ld)).not.toContain("500000");
  });

  it("says TELECOMMUTE for a remote role rather than inventing a place", () => {
    // A jobLocation of "Remote" puts the posting in a town called Remote.
    const ld = head.jobPostingLd(
      vacancy({ work_mode: "REMOTE", location_city: null, location_state: null, location_country: null }),
      ORIGIN,
      BRANDING,
    );
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld).not.toHaveProperty("jobLocation");
  });

  it("omits validThrough when the vacancy has no closing date", () => {
    // Google delists a posting the moment that date passes, so a guessed one
    // silently removes a role that is still open.
    const ld = head.jobPostingLd(vacancy({ closes_on: null }), ORIGIN, BRANDING);
    expect(ld).not.toHaveProperty("validThrough");
  });

  it("converts years of experience to the months the schema asks for", () => {
    const ld = head.jobPostingLd(vacancy(), ORIGIN, BRANDING);
    expect(ld.experienceRequirements.monthsOfExperience).toBe(36);
  });

  it("keeps a zero-experience requirement rather than dropping it", () => {
    // "No experience required" is a real answer and the one most likely to be
    // filtered out by a falsy check.
    const ld = head.jobPostingLd(vacancy({ experience_years_min: 0 }), ORIGIN, BRANDING);
    expect(ld.experienceRequirements.monthsOfExperience).toBe(0);
  });

  it("emits nothing for a vacancy with no title", () => {
    expect(head.jobPostingLd({}, ORIGIN, BRANDING)).toBeNull();
    expect(head.jobPostingLd(null, ORIGIN, BRANDING)).toBeNull();
  });
});

describe("BreadcrumbList", () => {
  it("numbers the trail from one and leaves the last step without a link", () => {
    // The last crumb IS the page; linking it to itself is the mistake that makes
    // a breadcrumb look automated.
    const ld = head.breadcrumbLd(ORIGIN, "/public", [
      { name: "Careers", path: "/careers" },
      { name: "Operations Officer", path: null },
    ]);
    expect(ld.itemListElement[0]).toMatchObject({
      position: 1,
      name: "Careers",
      item: "https://smartls.cm/public/careers",
    });
    expect(ld.itemListElement[1].position).toBe(2);
    expect(ld.itemListElement[1]).not.toHaveProperty("item");
  });

  it("builds its links from the host's own base", () => {
    // A tenant on their own domain serves the site at the root; naive
    // concatenation there emits "//careers", which a crawler reads as another
    // site entirely.
    const ld = head.breadcrumbLd(ORIGIN, "/", [
      { name: "Careers", path: "/careers" },
      { name: "Ops", path: null },
    ]);
    expect(ld.itemListElement[0].item).toBe("https://smartls.cm/careers");
  });

  it("emits nothing for an empty trail", () => {
    expect(head.breadcrumbLd(ORIGIN, "/", [])).toBeNull();
    expect(head.breadcrumbLd(ORIGIN, "/", null)).toBeNull();
  });
});
