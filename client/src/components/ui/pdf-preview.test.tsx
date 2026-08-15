/**
 * PdfPreview — canvas rendering of a local PDF, isolated from FileDrop.
 *
 * Pins the fallback the operator still has when pdf.js cannot paint (a password
 * file, a truncated scan, jsdom with no canvas): "Open in a new tab" uses a
 * blob URL at the top level, which Chrome will display. Also pins pager
 * behaviour on a multi-page document.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getPage, destroy, loadPdfjs } = vi.hoisted(() => ({
  getPage: vi.fn(),
  destroy: vi.fn(),
  loadPdfjs: vi.fn(),
}));

vi.mock("@/lib/pdfjs", () => ({
  loadPdfjs: () => loadPdfjs(),
  resetPdfjsLoader: vi.fn(),
}));

import { PdfPreview } from "./pdf-preview";

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "kyc.pdf", {
  type: "application/pdf",
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:pdf");
  URL.revokeObjectURL = vi.fn();
  getPage.mockReset();
  destroy.mockReset();
  loadPdfjs.mockReset();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(),
    putImageData: vi.fn(),
    createImageData: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => vi.restoreAllMocks());

describe("PdfPreview", () => {
  it("renders page 1 and lets the operator step through the document", async () => {
    loadPdfjs.mockResolvedValue({
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 3, getPage, destroy }),
      }),
    });
    getPage.mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 100 * scale,
        height: 140 * scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    });

    const user = userEvent.setup();
    render(<PdfPreview file={file} />);

    expect(await screen.findByText("Page 1 / 3")).toBeInTheDocument();
    expect(getPage).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
    expect(await screen.findByText("Page 2 / 3")).toBeInTheDocument();
  });

  it("falls back to opening a blob URL when the file cannot be painted", async () => {
    loadPdfjs.mockResolvedValue({
      getDocument: () => ({
        promise: Promise.reject(new Error("No password given")),
      }),
    });
    const open = vi.fn();
    vi.stubGlobal("open", open);

    const user = userEvent.setup();
    render(<PdfPreview file={file} />);

    expect(await screen.findByText(/password-protected/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open in a new tab" }));
    expect(open).toHaveBeenCalledWith("blob:pdf", "_blank", "noopener");
  });
});
