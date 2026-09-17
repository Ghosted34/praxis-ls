/**
 * The upload engine's guarantees, as tests.
 *
 * These pin the two things that were missing across the product rather than the
 * markup: that a preview appears for every picked image, and that the user is
 * shown a real 0→100 percentage ending in an explicit completion state. If a
 * later refactor makes either of those optional again, these fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageUpload, FilePicker } from "@/components/ui/image-upload";

/** jsdom implements neither of these; the engine uses both. */
beforeEach(() => {
  let n = 0;
  global.URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`);
  global.URL.revokeObjectURL = vi.fn();
  // No canvas/createImageBitmap in jsdom, so compressImage falls back to the
  // original file — which is the documented degradation and fine here.
  // @ts-expect-error deliberately removing it to exercise the fallback
  global.createImageBitmap = undefined;
});

afterEach(() => vi.restoreAllMocks());

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "scan.png", {
    type: "image/png",
  });

describe("ImageUpload", () => {
  it("shows a preview as soon as a file is picked", async () => {
    const user = userEvent.setup();
    render(
      <ImageUpload
        profile="document"
        label="Scan"
        send={() => new Promise(() => {})}
      />,
    );

    await user.upload(screen.getByLabelText("Scan"), png());

    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toMatch(/^blob:preview-/);
    });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  it("reports a percentage and ends at an explicit completion state", async () => {
    const user = userEvent.setup();
    let report: ((p: number) => void) | null = null;
    let finish: (() => void) | null = null;

    render(
      <ImageUpload
        profile="document"
        label="Scan"
        send={(_file, ctx) =>
          new Promise((resolve) => {
            report = ctx.onProgress;
            finish = () => resolve({ ok: true });
          })
        }
      />,
    );

    await user.upload(screen.getByLabelText("Scan"), png());
    await waitFor(() => expect(report).not.toBeNull());

    act(() => report!(42));
    await waitFor(() => expect(screen.getByText("42%")).toBeInTheDocument());

    // 100% must NOT be claimed from a progress event alone — the server has not
    // answered yet, and a bar that reads complete here is lying.
    act(() => report!(100));
    await waitFor(() => expect(screen.getByText("99%")).toBeInTheDocument());
    expect(screen.queryByText(/Upload complete/)).not.toBeInTheDocument();

    act(() => finish!());
    await waitFor(() =>
      expect(screen.getByText(/Upload complete/)).toBeInTheDocument(),
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("surfaces a failure with a retry rather than failing silently", async () => {
    const user = userEvent.setup();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network unreachable"))
      .mockResolvedValueOnce({ ok: true });

    render(<ImageUpload profile="document" label="Scan" send={send} />);
    await user.upload(screen.getByLabelText("Scan"), png());

    await waitFor(() =>
      expect(screen.getByText("Network unreachable")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByText(/Upload complete/)).toBeInTheDocument(),
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects an oversized file before uploading anything", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    render(
      <ImageUpload
        profile="document"
        label="Scan"
        maxBytes={4}
        send={send}
      />,
    );

    await user.upload(screen.getByLabelText("Scan"), png());

    await waitFor(() =>
      expect(screen.getByText(/the limit here is/)).toBeInTheDocument(),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("revokes its preview URL when the file is removed", async () => {
    const user = userEvent.setup();
    render(
      <ImageUpload
        profile="document"
        label="Scan"
        send={() => Promise.resolve({ ok: true })}
      />,
    );

    await user.upload(screen.getByLabelText("Scan"), png());
    await waitFor(() =>
      expect(screen.getByText(/Upload complete/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });
});

describe("FilePicker paste", () => {
  const pdf = () =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "clip.pdf", {
      type: "application/pdf",
    });

  /** The subset of a real clipboard the engine reads: an items list whose
   *  file-kind entry answers `getAsFile()`, and a `files` list. jsdom ships no
   *  DataTransfer, so this is the shape `fireEvent.paste` forwards onto the
   *  event's `clipboardData`. */
  const clipboard = (...files: File[]) => ({
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    files,
  });

  it("renders the third option by default", () => {
    render(<FilePicker onPick={() => {}} />);
    expect(
      screen.getByRole("button", { name: "or paste an image" }),
    ).toBeInTheDocument();
  });

  it("routes a pasted screenshot through onPick as one file", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} />);

    const surface = screen.getByRole("button", { name: /choose a file/i });
    surface.focus();
    fireEvent.paste(surface, {
      clipboardData: clipboard(png()),
    });

    expect(onPick).toHaveBeenCalledTimes(1);
    const list = onPick.mock.calls[0][0] as unknown as File[];
    expect(Array.from(list)).toHaveLength(1);
    expect(Array.from(list)[0].type).toBe("image/png");
  });

  it("accepts a pasted PDF when the picker accepts PDFs", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} accept="application/pdf" label="Contract" />);

    const surface = screen.getByRole("button", { name: /choose a file/i });
    surface.focus();
    fireEvent.paste(surface, {
      clipboardData: clipboard(pdf()),
    });

    expect(onPick).toHaveBeenCalledTimes(1);
    const list = onPick.mock.calls[0][0] as unknown as File[];
    expect(Array.from(list)[0].type).toBe("application/pdf");
  });

  it("rejects a pasted image on a PDF-only picker and shows the hint", async () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} accept="application/pdf" label="Contract" />);

    const surface = screen.getByRole("button", { name: /choose a file/i });
    surface.focus();
    fireEvent.paste(surface, {
      clipboardData: clipboard(png()),
    });

    await waitFor(() =>
      expect(
        screen.getByText("That file type isn't accepted here — choose a file instead."),
      ).toBeInTheDocument(),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("does not treat a text paste as a file or show a hint when unarmed", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} />);

    const surface = screen.getByRole("button", { name: /choose a file/i });
    surface.focus();
    fireEvent.paste(surface, {
      clipboardData: { items: [], files: [] },
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByText(/No image on the clipboard/)).toBeNull();
  });

  it("reports an empty clipboard on an armed paste target", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<FilePicker onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: "or paste an image" }));
    expect(
      screen.getByRole("button", { name: "Press Ctrl+V now" }),
    ).toBeInTheDocument();

    const target = screen.getByLabelText("Paste an image");
    fireEvent.paste(target, { clipboardData: { items: [], files: [] } });

    await waitFor(() =>
      expect(
        screen.getByText(/No image on the clipboard/),
      ).toBeInTheDocument(),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows a paste affordance on the inline variant and routes a pasted file", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <FilePicker
        variant="inline"
        accept="application/pdf"
        label="Attach a contract"
        onPick={onPick}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Paste a file" }));
    const target = screen.getByLabelText("Paste a file");
    fireEvent.paste(target, { clipboardData: clipboard(pdf()) });

    expect(onPick).toHaveBeenCalledTimes(1);
    const list = onPick.mock.calls[0][0] as unknown as File[];
    expect(Array.from(list)[0].type).toBe("application/pdf");
  });
});
