/**
 * FileDrop preview — the control every client / supplier / entity "Add document"
 * form uses to confirm the operator picked the right scan.
 *
 * WHAT THIS GUARDS. A sandboxed iframe pointed at a PDF data URL is what Chrome
 * renders as "This content is blocked. Contact the site owner to fix the issue."
 * Images were never affected (`<img>`). This suite pins: a PDF is handed to the
 * canvas previewer (never an iframe), an image still renders as an image, and
 * Expand preview opens the same content in a dialog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

import { FileDrop } from "./file-drop";

const pdf = (name = "clearance.pdf") =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, {
    type: "application/pdf",
  });
const png = (name = "scan.png") =>
  new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  getPage.mockReset();
  destroy.mockReset();
  loadPdfjs.mockReset().mockResolvedValue({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage,
        destroy,
      }),
    }),
  });
  getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 200 * scale,
      height: 280 * scale,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  });
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileDrop preview", () => {
  it("paints a picked PDF onto a canvas and never mounts an iframe", async () => {
    render(
      <FileDrop
        file={pdf()}
        onPick={vi.fn()}
        accept="application/pdf,image/png"
        label="Document file"
      />,
    );

    expect(
      await screen.findByRole("img", { name: /PDF preview/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Selected PDF preview")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    await waitFor(() => expect(loadPdfjs).toHaveBeenCalled());
    expect(await screen.findByText("Page 1 / 2")).toBeInTheDocument();
  });

  it("still previews an image with <img>, not the PDF canvas", async () => {
    render(
      <FileDrop
        file={png()}
        onPick={vi.fn()}
        accept="application/pdf,image/png"
        label="Document file"
      />,
    );

    const img = await screen.findByAltText("Selected image preview");
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(loadPdfjs).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("opens the same preview in a dialog from Expand preview", async () => {
    const user = userEvent.setup();
    render(
      <FileDrop
        file={pdf()}
        onPick={vi.fn()}
        accept="application/pdf"
        label="Document file"
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Expand preview" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Document preview" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", { name: /PDF preview/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("FileDrop paste", () => {
  const clipboard = (...files: File[]) => ({
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    files,
  });

  it("renders the paste affordance by default", () => {
    render(
      <FileDrop
        file={null}
        onPick={vi.fn()}
        accept="image/png"
        label="Document file"
      />,
    );

    expect(
      screen.getByRole("button", { name: "or paste an image" }),
    ).toBeInTheDocument();
  });

  it("accepts a pasted PDF when the control accepts PDFs", () => {
    const onPick = vi.fn();
    render(
      <FileDrop
        file={null}
        onPick={onPick}
        accept="application/pdf"
        label="Document file"
      />,
    );

    fireEvent.paste(screen.getByLabelText("Document file"), {
      clipboardData: clipboard(pdf()),
    });

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ type: "application/pdf" }));
  });

  it("rejects a pasted image on a PDF-only control and shows the hint", async () => {
    const onPick = vi.fn();
    render(
      <FileDrop
        file={null}
        onPick={onPick}
        accept="application/pdf"
        label="Document file"
      />,
    );

    fireEvent.paste(screen.getByLabelText("Document file"), {
      clipboardData: clipboard(png()),
    });

    await waitFor(() =>
      expect(
        screen.getByText("That file type isn't accepted here — choose a file instead."),
      ).toBeInTheDocument(),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("does nothing on a text-only paste when the control was not armed", () => {
    const onPick = vi.fn();
    render(
      <FileDrop
        file={null}
        onPick={onPick}
        accept="application/pdf"
        label="Document file"
      />,
    );

    fireEvent.paste(screen.getByLabelText("Document file"), {
      clipboardData: { items: [], files: [] },
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByText(/No file on the clipboard/)).toBeNull();
  });
});
