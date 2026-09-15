import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { BrandingProvider } from "@/app/branding";
import { QuoteBand } from "@/components/site/quote-band";
import { en } from "@/lib/i18n-dict";

/**
 * The quote band defers the wizard WITHOUT ever withholding it.
 *
 * ── WHAT F-18 FOUND, AND WHAT THIS PROTECTS ───────────────────────────────
 *
 * `services-page.tsx` imported `QuoteWizard` statically, which put 6.6 kB
 * gzipped — the largest single item on the route — into the critical path of a
 * page whose form sits two screens below the fold. `check-bundle.mjs` now fails
 * at 16 kB of route-own payload, and it fails on exactly that build.
 *
 * A gate can only see the bytes, though. It cannot see the two ways this fix
 * goes wrong, and both are worse than the 6.6 kB:
 *
 *   · the form never arrives for somebody, because the observer never fires —
 *     an old browser, a test environment, a reader who asked for reduced
 *     motion. A quote form that silently is not there is a lost enquiry, and
 *     nothing throws.
 *   · the form arrives UNDER THE READER'S THUMB, swapping a short placeholder
 *     for a tall wizard while they are looking at it. That is the reflow
 *     `fonts-fallback.css` exists to prevent, re-introduced by the fix for a
 *     different performance problem.
 *
 * So these assert the contract rather than the mechanism: content is never
 * conditional on an observer, and the fetch starts a screen early.
 */

/**
 * A controllable IntersectionObserver: nothing intersects until `fire()`.
 *
 * It resets the module registry and re-imports the component, which is not
 * ceremony. `reveal.tsx` holds ONE observer per page in a module-level binding —
 * deliberately, because thirty observers is thirty callbacks per scroll frame —
 * so the second test to install a stub constructor would never see it called:
 * `watchNear` finds the binding already set and reuses the instance the FIRST
 * test built, quietly registering this test's elements on the previous test's
 * callback list. A fresh registry is the only honest way to test a singleton.
 */
async function stubObserver() {
  const targets: Array<{ el: Element; cb: IntersectionObserverCallback; io: IntersectionObserver }> =
    [];
  const seen: IntersectionObserverInit[] = [];
  class IO {
    constructor(
      private cb: IntersectionObserverCallback,
      init?: IntersectionObserverInit,
    ) {
      seen.push(init ?? {});
    }
    observe(el: Element) {
      targets.push({ el, cb: this.cb, io: this as unknown as IntersectionObserver });
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  vi.stubGlobal("IntersectionObserver", IO);
  vi.resetModules();
  const { QuoteBand: Band } = await import("@/components/site/quote-band");
  return {
    Band,
    seen,
    async fire() {
      await act(async () => {
        for (const { el, cb, io } of targets) {
          cb(
            [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
            io,
          );
        }
        await new Promise((r) => setTimeout(r, 0));
      });
      // The lazy chunk resolves on a later microtask than the state update.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    },
  };
}

const mount = async (node: React.ReactNode) => {
  const view = render(<BrandingProvider>{node}</BrandingProvider>);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the deferred quote band", () => {
  it("renders the form outright where there is no IntersectionObserver", async () => {
    // jsdom has none, and neither does a browser old enough to matter. The
    // rule from reveal.tsx applies with more force here because this gates
    // CONTENT: an absent observer must mean MORE of the page, never less.
    expect(typeof IntersectionObserver).toBe("undefined");
    await mount(<QuoteBand />);
    await waitFor(() =>
      expect(screen.getByRole("group", { name: en.site.quote.mode })).toBeInTheDocument(),
    );
  });

  it("shows a reserved placeholder, not an empty box, before the reader arrives", async () => {
    const { Band } = await stubObserver();
    await mount(<Band />);
    const status = screen.getByRole("status", { name: en.common.loading });
    expect(status).toBeInTheDocument();
    // A reserved height, so the swap does not move the footer. An unsized
    // placeholder is the /careers skeleton bug with a different filename.
    expect(status.className).toMatch(/min-h-/);
  });

  it("mounts the wizard once the band is approaching", async () => {
    const io = await stubObserver();
    await mount(<io.Band />);
    expect(screen.queryByRole("group", { name: en.site.quote.mode })).toBeNull();
    await io.fire();
    await waitFor(() =>
      expect(screen.getByRole("group", { name: en.site.quote.mode })).toBeInTheDocument(),
    );
  });

  it("asks the observer for a screen of lead, so the chunk lands before the band does", async () => {
    // The whole difference between this and `useInView`. With no rootMargin the
    // fetch starts when the band is already on screen, and the reader watches
    // the placeholder swap — trading a bundle problem for a layout-shift one.
    const { Band, seen } = await stubObserver();
    await mount(<Band />);
    expect(seen.some((o) => String(o.rootMargin || "").includes("100%"))).toBe(true);
  });
});
