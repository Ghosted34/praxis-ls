import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  useScrollScrub,
  usePointerLight,
  useProximity,
  motionReduced,
} from "@/lib/motion";

/**
 * The motion primitives, held to the two promises that make them safe to put
 * on every page: they honour reduced motion by rendering the SETTLED state, and
 * they never drive animation through React.
 *
 * The second is not a style preference. A scroll scrub that calls setState
 * re-renders its subtree sixty times a second, and on the mid-range Android
 * this app exists for that is the difference between a page that glides and one
 * that stutters. It is also invisible in review and invisible in a screenshot,
 * which is exactly the kind of thing worth a test.
 */

type MediaState = { reduce: boolean; fine: boolean };

const setMedia = ({ reduce, fine }: MediaState) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? reduce : q.includes("pointer: fine") ? fine : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));

/** rAF runs synchronously so a test can assert the written value without
 *  waiting a frame — the hooks batch through it deliberately. */
beforeEach(() => {
  setMedia({ reduce: false, fine: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

/** Attach a hook's ref to a real element, since every one of them is a no-op
 *  without one. */
function mount<T extends HTMLElement>(
  use: () => React.RefObject<T>,
  el: HTMLElement = document.createElement("div"),
) {
  document.body.appendChild(el);
  const view = renderHook(() => {
    const ref = use();
    (ref as { current: HTMLElement | null }).current = el;
    return ref;
  });
  // A second render so the effect runs with the ref populated — the same
  // sequence React produces in a real tree, where the ref is attached during
  // commit and before effects fire.
  act(() => view.rerender());
  return { el, view };
}

describe("useScrollScrub", () => {
  it("renders the settled state under reduced motion, and attaches nothing", () => {
    setMedia({ reduce: true, fine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    const { el } = mount(() => useScrollScrub<HTMLDivElement>({ prop: "--p" }));

    expect(el.style.getPropertyValue("--p")).toBe("1");
    // Somebody who asked for less motion has not asked for a cheaper listener
    // that still moves things — there must be no scroll subscription at all.
    expect(addSpy.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
  });

  it("writes progress to a custom property rather than to React state", () => {
    let renders = 0;
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ top: 0, height: 500, bottom: 500, left: 0, right: 0, width: 100 }) as DOMRect;

    const view = renderHook(() => {
      renders += 1;
      const ref = useScrollScrub<HTMLDivElement>({ prop: "--p" });
      (ref as { current: HTMLElement | null }).current = el;
      return ref;
    });
    act(() => view.rerender());
    const rendersAfterMount = renders;

    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
    });

    // The property moved; the component did not re-render. That is the whole
    // contract.
    expect(el.style.getPropertyValue("--p")).not.toBe("");
    expect(renders).toBe(rendersAfterMount);
  });

  it("removes its listener and its property when the last subscriber leaves", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { el, view } = mount(() => useScrollScrub<HTMLDivElement>({ prop: "--p" }));
    act(() => view.unmount());

    expect(el.style.getPropertyValue("--p")).toBe("");
    expect(removeSpy.mock.calls.some(([type]) => type === "scroll")).toBe(true);
  });
});

describe("usePointerLight", () => {
  it("writes --lx/--ly from the pointer inside the element", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 200, height: 100, bottom: 100, right: 200 }) as DOMRect;
    mount(() => usePointerLight<HTMLDivElement>(), el);

    act(() => {
      const ev = new Event("pointermove") as PointerEvent;
      Object.defineProperty(ev, "clientX", { value: 50 });
      Object.defineProperty(ev, "clientY", { value: 25 });
      window.dispatchEvent(ev);
    });

    expect(Number(el.style.getPropertyValue("--lx"))).toBeCloseTo(0.25, 2);
    expect(Number(el.style.getPropertyValue("--ly"))).toBeCloseTo(0.25, 2);
  });

  it("does nothing on a coarse pointer", () => {
    // A touch device has no hover and no cursor to follow; useTilt is the
    // equivalent there. Listening anyway would burn a frame budget on every
    // scroll-drag for an effect nobody can see.
    setMedia({ reduce: false, fine: false });
    const addSpy = vi.spyOn(window, "addEventListener");
    mount(() => usePointerLight<HTMLDivElement>());
    expect(addSpy.mock.calls.filter(([t]) => t === "pointermove")).toHaveLength(0);
  });

  it("does nothing under reduced motion", () => {
    setMedia({ reduce: true, fine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    mount(() => usePointerLight<HTMLDivElement>());
    expect(addSpy.mock.calls.filter(([t]) => t === "pointermove")).toHaveLength(0);
  });
});

describe("useProximity", () => {
  it("measures to the nearest EDGE, not to the centre", () => {
    // A wide card measured from its centre reports "far" while the pointer is
    // sitting on its corner, which is the bug this distance function exists to
    // avoid.
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 600, height: 40, bottom: 40, right: 600 }) as DOMRect;
    mount(() => useProximity<HTMLDivElement>({ radius: 100 }), el);

    act(() => {
      const ev = new Event("pointermove") as PointerEvent;
      // Just outside the right edge: 10px away from the edge, 310px from centre.
      Object.defineProperty(ev, "clientX", { value: 610 });
      Object.defineProperty(ev, "clientY", { value: 20 });
      window.dispatchEvent(ev);
    });

    // 10px inside a 100px radius reads as very near. Centre-distance would have
    // reported 0.
    expect(Number(el.style.getPropertyValue("--near"))).toBeCloseTo(0.9, 2);
  });
});

describe("motionReduced", () => {
  it("reports the platform preference", () => {
    setMedia({ reduce: true, fine: true });
    expect(motionReduced()).toBe(true);
    setMedia({ reduce: false, fine: true });
    expect(motionReduced()).toBe(false);
  });
});

/**
 * ── EVERY SCRUB MUST FINISH WHILE ITS CONTENT IS STILL ON SCREEN ──────────
 *
 * `useScrollScrub`'s default range is `start: 1, end: 0` — "begins when the
 * element's top touches the bottom of the screen, ends when its bottom leaves
 * the top". For a band whose last element sits at its own bottom edge, that is
 * a threshold nobody is ever in a position to see.
 *
 * The arithmetic: with range (s, e), `--scrub` reaches 1 when
 *
 *     rect.top = vh·e − height          →  rect.bottom = vh·e
 *
 * So `end` IS the fraction of the viewport at which the element's bottom sits
 * when the scrub completes. At `end: 0` the element's bottom is exactly at the
 * top of the screen — the band has just left. Anything anchored near the end of
 * the scrub arrives, permanently, out of view.
 *
 * §9.1's timeline shipped with the default in its first draft and the 2026 entry
 * reached full opacity at scrollY 2289 with the band at −400..−62. Measured on
 * the built page in a real browser; no arithmetic test caught it, because the
 * arithmetic was right and the GEOMETRY was wrong. This is PR 4's ESG
 * annotation defect in a new shape, and it is the second time the programme has
 * paid for it — hence a test over every call site rather than one more fix.
 *
 * `{ start: 0, end: 1 }` on the insights reading rail is the deliberate
 * exception and is listed with its reason: that scrub is reading PROGRESS over
 * a whole article, where completing as the article's bottom reaches the bottom
 * of the viewport is exactly the meaning.
 */
describe("every scroll-scrub finishes while its content is on screen", () => {
  // `src/`, the same way `app/route-entrances.test.tsx` resolves it.
  const SRC = join(__dirname, "..");
  const HOOK_FILE = join(SRC, "lib", "motion.ts");

  /** Call sites whose `end` is intentionally at a viewport edge, with reasons. */
  const ALLOW_EDGE: Record<string, string> = {
    "features/insights/insight-page.tsx":
      "the reading rail is PROGRESS over an article, not an entrance. `end: 1` completes as the article's bottom reaches the bottom of the viewport, which is what 'you have read it all' means.",
  };

  function callSites(): Array<{ file: string; options: string }> {
    const out: Array<{ file: string; options: string }> = [];
    const walk = (dir: string) => {
      /* `withFileTypes` rather than a `statSync` per entry.
 
         The obvious version — `readdirSync(dir)` then `statSync(full)` then
         `readFileSync(full)` — asks the file system the same question three
         times and acts on the first answer, which CodeQL reports as a file
         system race and is right to: between the stat and the read the path
         can stop being the thing that was checked. `readdirSync`'s own Dirent
         carries the type from the single directory read, so there is no
         second question to disagree with the first. */
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        /* `lib/motion.ts` DECLARES the hook, and the declaration matches the
           same pattern a call does — `useScrollScrub<T extends HTMLElement>(
           options?: …)`. The first draft of this test reported it as a call
           site with no range, which is F-24's lesson arriving on schedule: a
           test that derives its own set gets the derivation wrong before it
           gets the assertion wrong. Excluded by name, not by pattern, so a
           second hook in this file would still be scanned. */
        if (full === HOOK_FILE) continue;

        const text = readFileSync(full, "utf8");
        const re = /useScrollScrub<[^>]*>\(([^)]*)\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          out.push({ file: relative(SRC, full), options: m[1].trim() });
        }
      }
    };
    walk(SRC);
    return out;
  }

  it("finds the call sites, so this test cannot pass by reading nothing", () => {
    // F-24's lesson: a gate-shaped test reports on a set it DERIVED, and the
    // derivation is where it goes wrong.
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it("narrows the range at every call site, or says why not", () => {
    const offenders: string[] = [];
    for (const { file, options } of callSites()) {
      if (ALLOW_EDGE[file]) continue;
      const end = /end:\s*([0-9.]+)/.exec(options)?.[1];
      // No options at all is the default `end: 0` — the defect.
      if (end === undefined) {
        offenders.push(`${file} — no range given, so end defaults to 0`);
        continue;
      }
      if (Number(end) <= 0) offenders.push(`${file} — end: ${end}`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a written reason for every call site allowed to end at an edge", () => {
    const files = new Set(callSites().map((s) => s.file));
    for (const [file, reason] of Object.entries(ALLOW_EDGE)) {
      expect(`${file}:${files.has(file)}`).toBe(`${file}:true`);
      expect(reason.length).toBeGreaterThan(40);
    }
  });
});
