/**
 * The URL a person types.
 *
 * A candidate asked for their LinkedIn types `www.linkedin.com/in/…` — no
 * scheme, because nobody types one. `<input type="url">` refuses it with a
 * native bubble at submit, and the server's `z.string().url()` would refuse it
 * too, so the application could not be sent at all. These pin the repair and,
 * as importantly, what it must not touch.
 */
import { describe, it, expect } from "vitest";
import { withScheme } from "./format";

describe("withScheme", () => {
  it("supplies the scheme nobody types", () => {
    expect(withScheme("www.linkedin.com/in/elisha-godwin-a408543b2")).toBe(
      "https://www.linkedin.com/in/elisha-godwin-a408543b2",
    );
    expect(withScheme("github.com/someone")).toBe("https://github.com/someone");
  });

  it("leaves a URL that already has one alone", () => {
    expect(withScheme("https://example.com")).toBe("https://example.com");
    expect(withScheme("http://example.com")).toBe("http://example.com");
    // Not mangled into `https://mailto:…` — the test is for A scheme, not for
    // the word "http".
    expect(withScheme("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(withScheme("//cdn.example.com/x")).toBe("//cdn.example.com/x");
  });

  it("trims, and leaves blank as blank", () => {
    // An empty optional field must stay empty rather than becoming "https://".
    expect(withScheme("")).toBe("");
    expect(withScheme("   ")).toBe("");
    expect(withScheme("  example.com  ")).toBe("https://example.com");
  });
});
