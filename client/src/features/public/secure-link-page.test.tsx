/**
 * THE SECURE-LINK VIEWER — what a counterparty sees at `/s/:token`.
 *
 * This page is the product's only unauthenticated document surface, so every
 * claim here is a claim about what a stranger's browser does with bytes the
 * tenant stored. Review #24 added the preview; these pin the parts of it that
 * fail silently.
 *
 *   1. THE SERVER DECIDES. The page renders a preview if and only if
 *      `preview_kind` says so — it never sniffs `content_type` itself. A
 *      security rule duplicated in the browser is a rule that drifts, in the
 *      one place an attacker can also read it.
 *   2. A PDF FRAME CARRIES NO `sandbox`, and that is deliberate: Chromium will
 *      not start its PDF viewer inside a sandboxed frame, so `sandbox=""` ships
 *      a blank pane the recipient cannot tell from a corrupt file. This is the
 *      assertion most likely to be "fixed" by a well-meaning reviewer, so it
 *      states its reason.
 *   3. DOWNLOAD SURVIVES EVERYTHING. Preview is an addition, never a
 *      replacement — an unpreviewable type must still be one click from the
 *      file, and the opaque 404 must stay opaque.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderScreen } from "@/test/screen-harness";
import { SecureLinkPage } from "./secure-link-page";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

type Meta = Record<string, unknown>;

const meta = (over: Meta = {}): Meta => ({
  label: "Invoice INV-2026-0311",
  target_kind: "VAULT_DOC",
  expires_at: new Date("2026-12-01").toISOString(),
  filename: "Invoice INV-2026-0311.pdf",
  content_type: "application/pdf",
  size_bytes: 24_000,
  download_path: "/public/secure/tok/download",
  preview_kind: null,
  ...over,
});

/** The page reads `:token` from the route, so it needs a real pattern. */
const render = (payload: Meta | { __error: unknown }) =>
  renderScreen(<SecureLinkPage />, {
    path: "/s/tok",
    pattern: "/s/:token",
    routes: { "/public/secure/tok": payload as never },
  });

beforeEach(() => vi.clearAllMocks());

describe("what the page is willing to render", () => {
  it("shows a PDF in a frame when the SERVER says it may", async () => {
    render(meta({ preview_kind: "pdf" }));
    const frame = await screen.findByTitle("Invoice INV-2026-0311");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute(
      "src",
      "/api/tenant/public/secure/tok/download?disposition=inline",
    );
  });

  it("does NOT sandbox the PDF frame — a sandboxed frame renders nothing in Chromium", async () => {
    // `sandbox=""` puts the frame in an opaque origin, where Chromium refuses
    // to instantiate its built-in PDF viewer; the response also sets
    // `object-src 'none'`, which closes the <embed> fallback. The protection
    // that remains is on the response (`default-src 'none'`, `nosniff`,
    // `frame-ancestors 'self'`) and is asserted in
    // tests/security/mail-secure-link-preview.test.js.
    render(meta({ preview_kind: "pdf" }));
    const frame = await screen.findByTitle("Invoice INV-2026-0311");
    expect(frame).not.toHaveAttribute("sandbox");
  });

  it("renders an image as an image, so no framing question arises", async () => {
    render(meta({ preview_kind: "image", content_type: "image/png", filename: "scan.png" }));
    const img = await screen.findByAltText("Invoice INV-2026-0311");
    expect(img.tagName).toBe("IMG");
  });

  it("RENDERS NOTHING IN PLACE when the server withheld permission", async () => {
    // content_type says PDF and preview_kind says no. The page must obey the
    // second: this is the test that fails the day someone re-derives the rule
    // in the browser from the type.
    render(meta({ preview_kind: null, content_type: "application/pdf" }));
    await screen.findByRole("button", { name: "Download" });
    expect(screen.queryByTitle("Invoice INV-2026-0311")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("treats an older API with no preview_kind at all as download-only", async () => {
    const { preview_kind: _omit, ...withoutTheField } = meta() as Record<string, unknown>;
    void _omit;
    render(withoutTheField);
    await screen.findByRole("button", { name: "Download" });
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("the download is never taken away", () => {
  it("offers it alongside a preview", async () => {
    render(meta({ preview_kind: "pdf" }));
    await screen.findByTitle("Invoice INV-2026-0311");
    const link = screen.getByRole("button", { name: "Download" }).closest("a");
    expect(link).toHaveAttribute("href", "/api/tenant/public/secure/tok/download");
  });

  it("still says what the file is and when it expires", async () => {
    render(meta({ preview_kind: "pdf" }));
    // 24_000 bytes rounds to 23 KB (KiB), which is what the page shows.
    expect(await screen.findByText(/23 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Available until/)).toBeInTheDocument();
  });

  it("keeps one opaque message for expired, revoked and never-existed", async () => {
    render({ __error: { status: 404, message: "This link has expired or been revoked." } });
    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("accessibility", () => {
  it("has no violations while previewing", async () => {
    // Scanned as an IMAGE preview rather than a PDF one. axe walks into frames
    // and jsdom cannot answer from one ("Respondable target must be a frame in
    // the current window"), so a PDF scan fails on the harness, not the markup.
    // The image branch renders the same surrounding page and IS scannable; the
    // iframe's own accessible name is covered by the `title` assertions above.
    const { container } = render(meta({ preview_kind: "image", content_type: "image/png" }));
    await screen.findByAltText("Invoice INV-2026-0311");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations in the download-only state", async () => {
    const { container } = render(meta());
    await screen.findByRole("button", { name: "Download" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
