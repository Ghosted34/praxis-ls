import { describe, expect, it } from "vitest";
import { browserUrlFor, isInInstalledWindow, isOutsiderPath } from "./installed-window";

describe("isOutsiderPath", () => {
  it.each(["/sign/abc", "/v/ABCD1234EFGH", "/verify", "/verify?code=x", "/s/tok"])("%s is for strangers", (p) => {
    expect(isOutsiderPath(p.split("?")[0])).toBe(true);
  });
  it.each(["/", "/login", "/settings", "/sales/quotes", "/signatures", "/vault", "/support", "/security"])(
    "%s is a staff route",
    (p) => expect(isOutsiderPath(p)).toBe(false),
  );
});

describe("isInInstalledWindow", () => {
  const mm = (mode: string) => (q: string) => ({ matches: q === `(display-mode: ${mode})` });
  it("false in a tab, true in an installed window", () => {
    expect(isInInstalledWindow(mm("browser"))).toBe(false);
    expect(isInInstalledWindow(mm("standalone"))).toBe(true);
    expect(isInInstalledWindow(undefined)).toBe(false);
  });
});

describe("browserUrlFor", () => {
  const link = "https://acme.praxisls.com/sign/tok123?lang=fr";
  it("Android: explicit Chrome intent with the original as fallback", () => {
    const u = browserUrlFor(link, "Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile");
    expect(u).toBe(
      `intent://acme.praxisls.com/sign/tok123?lang=fr#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(link)};end`,
    );
  });
  it("desktop: unchanged", () => {
    expect(browserUrlFor(link, "Mozilla/5.0 (Macintosh) Chrome/128")).toBe(link);
  });
});
