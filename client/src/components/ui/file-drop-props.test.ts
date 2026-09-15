/**
 * fileDropProps — the adapter that made the percentage automatic.
 *
 * The behaviour worth pinning is the idle case. A bar sitting at 0% before
 * anything has started is noise, and a bar at 0% is also how a broken upload
 * looks — so "nothing picked" and "picked but not started" must both render as
 * no bar at all, not as a stalled one.
 */
import { describe, it, expect } from "vitest";
import { fileDropProps } from "@/components/ui/file-drop";
import type { UploadItem, UploadState } from "@/lib/use-upload";

const png = (name = "scan.png") =>
  new File([new Uint8Array([137, 80])], name, { type: "image/png" });

function item(over: Partial<UploadItem<unknown>> = {}): UploadItem<unknown> {
  return {
    id: "up_1",
    file: png(),
    prepared: null,
    previewUrl: null,
    state: "idle" as UploadState,
    percent: 0,
    error: null,
    errorCause: null,
    result: null,
    originalBytes: 100,
    bytes: 100,
    ...over,
  };
}

describe("fileDropProps", () => {
  it("renders no bar when nothing is picked", () => {
    expect(fileDropProps(null)).toEqual({
      file: null,
      uploadProgress: null,
      uploadSuccess: false,
      error: null,
    });
  });

  it("renders no bar while idle — 0% would read as a stalled upload", () => {
    expect(fileDropProps(item()).uploadProgress).toBeNull();
  });

  it("reports the percentage while uploading", () => {
    const p = fileDropProps(item({ state: "uploading", percent: 42 }));
    expect(p.uploadProgress).toBe(42);
    expect(p.uploadSuccess).toBe(false);
  });

  it("reports completion only on success", () => {
    expect(fileDropProps(item({ state: "compressing" })).uploadSuccess).toBe(
      false,
    );
    expect(
      fileDropProps(item({ state: "uploading", percent: 99 })).uploadSuccess,
    ).toBe(false);
    const done = fileDropProps(item({ state: "success", percent: 100 }));
    expect(done.uploadSuccess).toBe(true);
    expect(done.uploadProgress).toBe(100);
  });

  it("drops the bar on failure and surfaces the message instead", () => {
    const p = fileDropProps(
      item({ state: "error", percent: 0, error: "Network unreachable" }),
    );
    expect(p.uploadProgress).toBeNull();
    expect(p.error).toBe("Network unreachable");
  });

  it("shows the COMPRESSED file, so the chip states what will be sent", () => {
    const original = png("huge.png");
    const prepared = png("huge.webp");
    expect(fileDropProps(item({ file: original, prepared })).file).toBe(
      prepared,
    );
    // Before compression has run there is only the original.
    expect(fileDropProps(item({ file: original, prepared: null })).file).toBe(
      original,
    );
  });
});
