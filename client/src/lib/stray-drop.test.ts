import { describe, it, expect, afterEach } from "vitest";
import { installStrayDropGuard } from "./stray-drop";

/**
 * The reported symptom this closes: "I tried to upload a picture and got a blank
 * black screen." A file dropped near, but not on, a dropzone navigated the tab
 * to the file itself — so the test is about `defaultPrevented`, which is what
 * decides whether the browser navigates.
 */

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
});

/** A DragEvent carrying `types`, built the way jsdom will accept. */
function dragEvent(type: string, types: string[]): DragEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", {
    value: { types, dropEffect: "copy" },
    configurable: true,
  });
  return e;
}

describe("installStrayDropGuard", () => {
  it("swallows a file dropped outside any dropzone", () => {
    teardown = installStrayDropGuard();
    const drop = dragEvent("drop", ["Files"]);
    window.dispatchEvent(drop);
    // Prevented === the browser does not navigate to the file.
    expect(drop.defaultPrevented).toBe(true);
  });

  it("marks the unclaimed dragover as no-drop so the target is discoverable", () => {
    teardown = installStrayDropGuard();
    const over = dragEvent("dragover", ["Files"]);
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe("none");
  });

  it("leaves a drag a real dropzone has already claimed alone", () => {
    teardown = installStrayDropGuard();
    const over = dragEvent("dragover", ["Files"]);
    // What <FileDrop> does on its own dragover, before this bubbles to window.
    over.preventDefault();
    window.dispatchEvent(over);
    // Untouched: the dropzone owns the cursor, so it still reads as droppable.
    expect(over.dataTransfer!.dropEffect).toBe("copy");
  });

  it("does not interfere with a drag that carries no files", () => {
    teardown = installStrayDropGuard();
    const over = dragEvent("dragover", ["text/plain"]);
    window.dispatchEvent(over);
    // A text or link drag, or an internal reorder — not the failure mode, and
    // cancelling every drag would break the ones that work.
    expect(over.defaultPrevented).toBe(false);
  });

  it("stops guarding once torn down", () => {
    const stop = installStrayDropGuard();
    stop();
    const drop = dragEvent("drop", ["Files"]);
    window.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
  });
});
