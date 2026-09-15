/**
 * Social link host validation — guide §9.7: "Social links: host validation
 * verified; a blank platform renders nothing."
 *
 * ── THIS TEST DID NOT EXIST, AND THE RULE IT COVERS IS A SECURITY RULE ────
 *
 * `isValidSocialUrl` has been the gate on every social link a tenant can
 * publish since PR 2 (13781, §6.6). It is called by the settings form and again
 * by the API, and until now nothing asserted that it works. §9.7 asks for it to
 * be VERIFIED, and "the function looks right" is not verification of a check
 * whose failure mode is a phishing link in a tenant's own footer.
 *
 * `packages/shared/design/social.js` states the stake in its own header and it
 * is worth repeating, because it explains why this file tests rejections much
 * harder than acceptances:
 *
 *   "A LinkedIn glyph, in a tenant's own footer, under the tenant's branding,
 *    pointing at any URL at all, is a phishing primitive with the tenant's
 *    reputation attached to it."
 *
 * ── THE THREE CLASSES OF ATTACK ON A HOST CHECK ──────────────────────────
 *
 * Every one of these is accepted by the naive `/linkedin\.com/` test somebody
 * reaches for first, which is why the implementation parses the URL instead:
 *
 *   SUFFIX     https://linkedin.com.evil.com/  — the real host is evil.com
 *   PATH       https://evil.com/linkedin.com   — the string appears, in a path
 *   QUERY      https://evil.com/?u=linkedin.com
 *   USERINFO   https://linkedin.com@evil.com/  — everything before @ is a user
 */
"use strict";

const { isValidSocialUrl, SOCIAL_IDS, socialById } = require("@praxis/shared/design/social");

describe("the registry", () => {
  test("every platform has an id, a name, a host pattern and a placeholder", () => {
    // The footer needs a glyph and an accessible name for each; the form needs
    // a placeholder; the API needs the host. A row missing any of them is a
    // gap that only shows up on a tenant's live site.
    for (const id of SOCIAL_IDS) {
      const p = socialById(id);
      expect(`${id}:${!!p.name}:${!!p.host}:${!!p.placeholder}`).toBe(`${id}:true:true:true`);
    }
  });

  test("every platform's own placeholder passes its own validator", () => {
    // The placeholder is what a tenant copies. One that the API then refuses is
    // the worst possible first impression of a settings field.
    for (const id of SOCIAL_IDS) {
      expect(`${id}:${isValidSocialUrl(id, socialById(id).placeholder)}`).toBe(`${id}:true`);
    }
  });

  test("an unknown platform is refused whatever the URL", () => {
    expect(isValidSocialUrl("myspace", "https://myspace.com/acme")).toBe(false);
  });
});

describe("accepts a real link on the platform's own host", () => {
  test.each([
    ["linkedin", "https://www.linkedin.com/company/smart-logistics"],
    ["linkedin", "https://linkedin.com/in/someone"],
    ["linkedin", "https://fr.linkedin.com/company/smart-logistics"],
    ["facebook", "https://www.facebook.com/smartlogistics"],
    ["facebook", "https://fb.com/smartlogistics"],
    ["instagram", "https://www.instagram.com/smartlogistics"],
    ["youtube", "https://www.youtube.com/@smartlogistics"],
    ["youtube", "https://youtu.be/abcdefg"],
    // Both spellings are the same account. Refusing the older one would be
    // pedantry with a cost — a tenant may hold either link.
    ["x", "https://x.com/smartlogistics"],
    ["x", "https://twitter.com/smartlogistics"],
    ["tiktok", "https://www.tiktok.com/@smartlogistics"],
    // wa.me is the canonical click-to-chat host and the one a freight desk in
    // this region actually publishes.
    ["whatsapp", "https://wa.me/237600000000"],
  ])("%s ← %s", (platform, url) => {
    expect(isValidSocialUrl(platform, url)).toBe(true);
  });
});

describe("refuses a host that merely CONTAINS the platform's name", () => {
  test.each([
    ["linkedin", "https://linkedin.com.evil.com/company/x", "suffix"],
    ["linkedin", "https://evil.com/linkedin.com", "path"],
    ["linkedin", "https://evil.com/?u=https://linkedin.com", "query"],
    ["linkedin", "https://linkedin.com@evil.com/", "userinfo"],
    ["facebook", "https://notfacebook.com/x", "prefix"],
    ["x", "https://x.com.evil.io/acme", "suffix"],
    ["whatsapp", "https://wa.me.evil.com/237600000000", "suffix"],
  ])("%s ✗ %s (%s)", (platform, url) => {
    expect(isValidSocialUrl(platform, url)).toBe(false);
  });
});

describe("refuses anything that is not an https URL", () => {
  test.each([
    // A footer link is a public endorsement, and this product does not publish
    // one over a channel that can be rewritten in transit.
    ["linkedin", "http://www.linkedin.com/company/x"],
    ["linkedin", "//www.linkedin.com/company/x"],
    ["linkedin", "javascript:alert(1)"],
    ["linkedin", "data:text/html,<script>alert(1)</script>"],
    ["linkedin", "www.linkedin.com/company/x"],
    ["linkedin", "not a url at all"],
    ["linkedin", ""],
  ])("%s ✗ %s", (platform, url) => {
    expect(isValidSocialUrl(platform, url)).toBe(false);
  });

  test("a non-string is refused rather than coerced", () => {
    for (const value of [null, undefined, 42, {}, ["https://linkedin.com"]]) {
      expect(isValidSocialUrl("linkedin", value)).toBe(false);
    }
  });
});

describe("a link for one platform is not a link for another", () => {
  test("a LinkedIn URL saved under the Facebook glyph is refused", () => {
    // The glyph is the claim. Somebody pasting into the wrong row would
    // otherwise publish a Facebook icon that opens LinkedIn.
    expect(isValidSocialUrl("facebook", "https://www.linkedin.com/company/x")).toBe(false);
    expect(isValidSocialUrl("instagram", "https://www.facebook.com/x")).toBe(false);
  });
});
