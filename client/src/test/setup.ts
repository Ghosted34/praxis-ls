/**
 * Vitest setup — runs before every test file.
 *
 * Registers jest-dom matchers (toBeInTheDocument, toHaveAccessibleName, …) and
 * jest-axe's toHaveNoViolations, so any component test can assert accessibility
 * without extra wiring. That is deliberate: the audit's a11y findings (F13) are
 * only permanently fixed if a regression fails the build.
 */
import "@testing-library/jest-dom/vitest";
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

/**
 * jsdom gaps that the Radix primitives (Phase 2) hit.
 *
 * These are NOT workarounds for anything wrong in our components — jsdom simply
 * does not implement the Pointer Events capture API, element scrolling, or
 * ResizeObserver, and Radix's Select and popper layer call all three. Without
 * these, `Select` throws "target.hasPointerCapture is not a function" the moment
 * a test opens it. Real browsers have them; Playwright coverage would not need
 * this shim.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof globalThis.DOMRect === "undefined") {
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
    top = 0;
    right = 0;
    bottom = 0;
    left = 0;
    static fromRect() {
      return new globalThis.DOMRect();
    }
    toJSON() {
      return {};
    }
  } as unknown as typeof DOMRect;
}

/**
 * Unmount, then make sure the body really is empty.
 *
 * `cleanup()` unmounts the trees RTL rendered, which is enough when a test
 * finishes. It is not enough when a test is ABORTED — a vitest timeout rejects
 * the test's promise but does not stop the interaction that was in flight, so
 * `user.type` can go on resolving and React can commit one more render into a
 * portal after cleanup has run. Radix mounts its dialogs straight onto
 * `document.body`, along with `data-scroll-locked` and `pointer-events: none`.
 *
 * The result is the confusing failure we actually hit: one test times out under
 * load, and the NEXT test — which is fine — fails with "Unable to find a label
 * with the text of: Your answer" against a dump of the previous test's dialog,
 * stuck three questions further on. Two red tests, one cause, and the innocent
 * one is the one you read first.
 *
 * Clearing the body and the attributes Radix leaves on it means a test can only
 * ever be failed by its own behaviour.
 */
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  document.body.removeAttribute("data-scroll-locked");
});
