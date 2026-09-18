/**
 * previewUrlFor — the guard between a user-chosen file and an `<img src>`.
 *
 * CodeQL flags that flow as js/xss-through-dom (high): data the user supplied
 * reaching a URL sink. `URL.createObjectURL` can only return `blob:`, so it is
 * not exploitable today — but the guard is what makes that checkable at the
 * sink rather than an argument about an API contract, and the rejection case
 * below is what would matter the day someone swaps in a FileReader data: URL,
 * where `data:text/html` IS reachable.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  previewUrlFor,
  isPreviewableImage,
  resizeDimensions,
} from "@/lib/image-compress";

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "scan.png", {
    type: "image/png",
  });

afterEach(() => vi.restoreAllMocks());

describe("previewUrlFor", () => {
  it("returns the object URL when it is a blob: URL", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:https://app.example/abc-123"),
    });
    expect(previewUrlFor(png())).toBe("blob:https://app.example/abc-123");
  });

  it("REFUSES a non-blob URL rather than passing it to an src", () => {
    // The shape the rule exists for. If object-URL creation were ever replaced
    // by something that can produce this, the preview is dropped instead of
    // becoming a live sink.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "data:text/html,<script>alert(1)</script>"),
    });
    expect(previewUrlFor(png())).toBeNull();
  });

  it("refuses a javascript: URL", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "javascript:alert(1)"),
    });
    expect(previewUrlFor(png())).toBeNull();
  });

  it("degrades to no preview where object URLs are unavailable", () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        throw new Error("not supported");
      }),
    });
    expect(previewUrlFor(png())).toBeNull();
  });
});

describe("isPreviewableImage", () => {
  it("accepts images and rejects a PDF", () => {
    expect(isPreviewableImage(png())).toBe(true);
    expect(
      isPreviewableImage(
        new File([new Uint8Array([37])], "x.pdf", { type: "application/pdf" }),
      ),
    ).toBe(false);
    expect(isPreviewableImage(null)).toBe(false);
  });
});

describe("resizeDimensions", () => {
  it("lets a required width win over a smaller optimisation cap", () => {
    // A 1200px cover must not become 1024px just because a brand profile was
    // selected by a caller.
    expect(resizeDimensions(1200, 800, 1024, 1200)).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("preserves width for a tall source while still avoiding enlargement", () => {
    expect(resizeDimensions(1300, 5000, 1024, 1200)).toEqual({
      width: 1200,
      height: 4615,
    });
    expect(resizeDimensions(800, 5000, 1024, 1200)).toEqual({
      width: 800,
      height: 5000,
    });
  });

  it("can preserve both dimensions for a square icon floor", () => {
    expect(resizeDimensions(512, 2048, 1024, 512, 512)).toEqual({
      width: 512,
      height: 2048,
    });
  });
});
