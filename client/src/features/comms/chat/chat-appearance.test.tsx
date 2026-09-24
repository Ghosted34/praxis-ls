import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatAppearance } from "./chat-appearance-store";
import { contrast, type Rgb } from "@/lib/theme";

// A brand with a full-ish palette; accent === accentDeep on purpose, to prove
// the swatch list de-duplicates. primary is the "Default", never a swatch.
vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({
    branding: {
      primary: "#f5821f",
      secondary: "#1884c4",
      accent: "#0f766e",
      accentDeep: "#0f766e",
    },
  }),
}));

function rgbOf(v: string | undefined): Rgb {
  const m = String(v).match(/rgb\((\d+) (\d+) (\d+)\)/);
  if (!m) throw new Error(`not an rgb() string: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* @silent:storage — nothing persisted to clear */
  }
  document.documentElement.classList.remove("dark");
});

describe("chat appearance", () => {
  it("offers only the brand's own colours as swatches, primary excluded and deduped", () => {
    const { result } = renderHook(() => useChatAppearance());
    const values = result.current.swatches.map((s) => s.value);
    expect(values).not.toContain("#f5821f"); // primary is the Default, not a swatch
    expect(values).toContain("#1884c4"); // secondary
    expect(values).toContain("#0f766e"); // accent
    expect(values.filter((v) => v === "#0f766e")).toHaveLength(1); // accent == accentDeep, once
  });

  it("persists an accent and derives an AA-safe ink for the shell", () => {
    const { result } = renderHook(() => useChatAppearance());
    act(() => {
      result.current.setAccent(null);
    });
    expect(result.current.accent).toBeNull();
    expect(result.current.shellStyle).toEqual({}); // no override on Default

    act(() => {
      result.current.setAccent("#1884c4");
    });
    expect(localStorage.getItem("comms:chat-accent")).toBe("#1884c4");
    const style = result.current.shellStyle as Record<string, string>;
    expect(style["--primary"]).toBe("rgb(24 132 196)");
    // The derived surface-ink must clear WCAG AA on the light card (#fff).
    expect(contrast(rgbOf(style["--primary-ink"]), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it("stores and clears a per-device wallpaper", () => {
    const { result } = renderHook(() => useChatAppearance());
    act(() => {
      result.current.setWallpaper(null);
    });
    expect(result.current.hasCustomWallpaper).toBe(false);

    act(() => {
      const ok = result.current.setWallpaper("data:image/webp;base64,AAAA");
      expect(ok).toBe(true);
    });
    expect(result.current.hasCustomWallpaper).toBe(true);
    expect(result.current.wallpaper).toBe("data:image/webp;base64,AAAA");
    expect(localStorage.getItem("comms:chat-wallpaper")).toBe("data:image/webp;base64,AAAA");

    act(() => {
      result.current.clearWallpaper();
    });
    expect(result.current.hasCustomWallpaper).toBe(false);
    expect(localStorage.getItem("comms:chat-wallpaper")).toBeNull();
  });
});
