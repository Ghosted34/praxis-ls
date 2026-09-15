/**
 * The upload engine's guarantees, as tests.
 *
 * These pin the two things that were missing across the product rather than the
 * markup: that a preview appears for every picked image, and that the user is
 * shown a real 0→100 percentage ending in an explicit completion state. If a
 * later refactor makes either of those optional again, these fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageUpload } from "@/components/ui/image-upload";

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
