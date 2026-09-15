import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SocialRow, PLATFORM_NAME } from "@/components/site/social-row";
import { SOCIAL_GLYPH_IDS, hasGlyph } from "@/components/ui/social-glyphs";
import "@/lib/i18n";

/**
 * The footer's social row (§9.5), and §9.7's two acceptance criteria for it:
 * "host validation verified; a blank platform renders nothing."
 *
 * ── WHERE HOST VALIDATION IS AND IS NOT TESTED ────────────────────────────
 *
 * It is enforced on the WRITE path — `isValidSocialUrl` in
 * `@praxis/shared/design/social`, called by the settings form and again by the
 * API — and `tests/unit/social-url.test.js` covers it there, including the
 * rejections a naive regex accepts (`https://linkedin.com.evil.com`,
 * `https://evil.com/?u=linkedin.com`). This component deliberately does not
 * re-check: importing the registry would pull `@praxis/shared` into a bundle
 * D-1 spent real effort keeping it out of.
 *
 * What IS asserted here is the part this file owns — that the platform it
 * receives is one it can draw and name, and that nothing is rendered for a
 * platform that is not.
 */

const stubFetch = (rows: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("the platform registry and the glyph set agree", () => {
  it("has a glyph for every platform it can name", () => {
    // Two maps in two files. A platform in one and not the other is a footer
    // entry with a hole in it or a nameless icon — and neither would fail a
    // build without this.
    expect(Object.keys(PLATFORM_NAME).sort()).toEqual([...SOCIAL_GLYPH_IDS].sort());
  });

  it("matches the shared registry's own list", () => {
    // `@praxis/shared/design/social.js` is the authority — the settings form
    // renders one row per platform in it and the API refuses anything else.
    // The list is duplicated here rather than imported (see the component's
    // header on D-1 and the bundle), so this is what stops the copy drifting.
    expect(Object.keys(PLATFORM_NAME).sort()).toEqual(
      ["facebook", "instagram", "linkedin", "tiktok", "whatsapp", "x", "youtube"].sort(),
    );
  });

  it("refuses to draw a platform it does not have", () => {
    expect(hasGlyph("linkedin")).toBe(true);
    expect(hasGlyph("myspace")).toBe(false);
  });
});

describe("a blank platform renders nothing (§9.7)", () => {
  it("renders nothing at all when the tenant has registered none", async () => {
    stubFetch([]);
    const { container } = render(<SocialRow />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // No heading, no empty row, no placeholder icons. 13781 DELETES a row when
    // the field is cleared, so "registered" and "has a link" cannot come apart.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { container } = render(<SocialRow />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("drops a row with an empty URL rather than linking nowhere", async () => {
    stubFetch([
      { platform: "linkedin", url: "https://www.linkedin.com/company/x" },
      { platform: "facebook", url: "" },
    ]);
    render(<SocialRow />);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    // A footer icon linking nowhere is worse than one icon fewer: it is a dead
    // link in the most-inspected part of a marketing page.
    expect(screen.getByRole("link", { name: /LinkedIn/ })).toBeInTheDocument();
  });

  it("drops a platform it has no glyph for rather than drawing a blank square", async () => {
    stubFetch([
      { platform: "linkedin", url: "https://www.linkedin.com/company/x" },
      { platform: "myspace", url: "https://myspace.com/x" },
    ]);
    render(<SocialRow />);
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
  });
});

describe("the links themselves", () => {
  it("names each one by its platform, not all of them 'Social'", async () => {
    stubFetch([
      { platform: "linkedin", url: "https://www.linkedin.com/company/x" },
      { platform: "whatsapp", url: "https://wa.me/237000000" },
    ]);
    render(<SocialRow />);
    // A row of seven links all called "Social" is a row a screen-reader user
    // cannot navigate.
    await waitFor(() => expect(screen.getByRole("link", { name: /LinkedIn/ })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /WhatsApp/ })).toBeInTheDocument();
  });

  it("opens every link with noopener AND noreferrer (§9.5)", async () => {
    stubFetch([{ platform: "x", url: "https://x.com/acme" }]);
    render(<SocialRow />);
    await waitFor(() => expect(screen.getByRole("link")).toBeInTheDocument());
    const link = screen.getByRole("link");
    // `noopener` stops the opened page reaching back through `window.opener`;
    // `noreferrer` keeps the tenant's visitor list out of a social network's
    // analytics.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("href", "https://x.com/acme");
  });
});
