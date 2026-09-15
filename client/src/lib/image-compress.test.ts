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
import { previewUrlFor, isPreviewableImage } from "@/lib/image-compress";

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
