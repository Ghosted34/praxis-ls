/**
 * Density (Phase 5).
 *
 * The value of these is that they assert the CONTRACT the CSS depends on: the
 * attribute name, the three level names, and the padding each maps to. If a
 * refactor renames `data-density` or drops a level, `index.css` keeps compiling
 * and every table silently falls back to `:root`'s default — a regression with
 * no error and no visual tell on the default setting, which is the only one a
 * developer usually looks at.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getDensity, setDensity, initDensity, isDensity, DENSITY_PY, DENSITY_ROW_PX } from "@/lib/density";

describe("density", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-density");
  });
  afterEach(() => vi.restoreAllMocks());

  it("defaults to `default` when nothing is stored", () => {
    expect(getDensity()).toBe("default");
  });

  it("round-trips a choice through localStorage and the DOM attribute", () => {
    setDensity("compact");
    expect(getDensity()).toBe("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("applies the stored preference at boot", () => {
    localStorage.setItem("praxis.density", "comfortable");
    initDensity();
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
  });

  it("ignores a stored value that is not a level", () => {
    // A stale key from an older build, or a user editing localStorage, must not
    // put the app into a state with no --row-py at all.
    localStorage.setItem("praxis.density", "tiny");
    expect(getDensity()).toBe("default");
  });

  it("survives localStorage throwing", () => {
    // Private-mode Safari throws on access rather than returning null. A
    // preference read is not worth taking the app down for.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getDensity()).toBe("default");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setDensity("compact")).not.toThrow();
    // Still applied for this session, just not remembered.
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("announces a change so geometry-measuring code can react", () => {
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e as CustomEvent<string>).detail);
    window.addEventListener("praxis:density", onChange);
    setDensity("comfortable");
    window.removeEventListener("praxis:density", onChange);
    expect(seen).toEqual(["comfortable"]);
  });

  it("keeps the documented row heights in step with the padding", () => {
    // 2 × padding + the 20px line box the 13px body type produces.
    const px = (rem: string) => Number(rem.replace("rem", "")) * 16;
    for (const level of ["compact", "default", "comfortable"] as const) {
      expect(2 * px(DENSITY_PY[level]) + 20).toBe(DENSITY_ROW_PX[level]);
    }
  });

  it("narrows unknown input", () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("COMPACT")).toBe(false);
    expect(isDensity(null)).toBe(false);
  });
});
