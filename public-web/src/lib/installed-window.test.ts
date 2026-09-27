import { describe, expect, it } from "vitest";
import { browserUrlFor, isInInstalledWindow } from "./installed-window";

const mm = (active: string | null) => (q: string) => ({ matches: active !== null && q === `(display-mode: ${active})` });

describe("isInInstalledWindow", () => {
  it("is false in a browser tab", () => {
    expect(isInInstalledWindow(mm("browser"))).toBe(false);
    expect(isInInstalledWindow(mm(null))).toBe(false);
  });
  it.each(["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"])("is true in %s", (mode) => {
    expect(isInInstalledWindow(mm(mode))).toBe(true);
  });
  it("is false when matchMedia is unavailable", () => {
    expect(isInInstalledWindow(undefined)).toBe(false);
  });
});

describe("browserUrlFor", () => {
  const link = "https://acme.praxisls.com/portal/set-password?token=abc%2Bdef#top";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36";
  const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36";

  it("on Android, targets Chrome explicitly so the installed app cannot capture it again", () => {
    const u = browserUrlFor(link, android);
    expect(u.startsWith("intent://acme.praxisls.com/portal/set-password?token=abc%2Bdef#Intent;")).toBe(true);
    expect(u).toContain(";scheme=https;");
    expect(u).toContain(";package=com.android.chrome;");
    expect(u).toContain(`S.browser_fallback_url=${encodeURIComponent(link)};`);
    expect(u.endsWith(";end")).toBe(true);
  });

  it("keeps the token intact (it is the whole point of the set-password link)", () => {
    expect(browserUrlFor(link, android)).toContain("?token=abc%2Bdef");
  });

  it("elsewhere, is the URL unchanged", () => {
    expect(browserUrlFor(link, desktop)).toBe(link);
  });

  it("leaves a non-http URL alone", () => {
    expect(browserUrlFor("mailto:a@b.c", android)).toBe("mailto:a@b.c");
  });
});
