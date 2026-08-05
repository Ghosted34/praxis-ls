/**
 * The font library. Three things carry real weight here: the set is closed and
 * self-hosted, a pre-library free-text value still resolves to its family, and
 * loading is lazy and de-duplicated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FONTS, fontById, fontByValue, fontGroups, loadFont, loadFonts, __resetFontCache } from "./fonts";

beforeEach(() => __resetFontCache());

describe("the library", () => {
  it("ships the agreed fifteen families, with unique ids and names", () => {
    expect(FONTS).toHaveLength(15);
    expect(new Set(FONTS.map((f) => f.id)).size).toBe(15);
    expect(new Set(FONTS.map((f) => f.name)).size).toBe(15);
  });

  /**
   * The whole premise: what a tenant picks is what every user renders. A family
   * with no loader would be a name in a dropdown that resolves to the fallback
   * on any machine without it installed — which is the bug this replaced.
   */
  it("gives every family a loader, so none is a name-only entry", () => {
    for (const f of FONTS) expect(typeof f.load).toBe("function");
  });

  /**
   * Segoe UI, SF Pro and Helvetica Neue are proprietary and cannot be
   * redistributed. Their open counterparts stand in for them; this test is the
   * guard against someone adding the licensed names back as bare stacks.
   */
  it("offers no proprietary family, and carries the open replacements", () => {
    const names = FONTS.map((f) => f.name);
    expect(names).not.toContain("Segoe UI");
    expect(names).not.toContain("SF Pro");
    expect(names).not.toContain("Helvetica Neue");
    expect(names).toEqual(expect.arrayContaining(["Noto Sans", "Plus Jakarta Sans", "Work Sans"]));
  });

  it("names the bundled face first in every stack, ahead of the fallbacks", () => {
    for (const f of FONTS) {
      expect(f.stack.startsWith(`"${f.name}`)).toBe(true);
    }
  });

  it("covers all three roles", () => {
    const roles = new Set(FONTS.map((f) => f.role));
    expect([...roles].sort()).toEqual(["mono", "sans", "serif"]);
  });
});

describe("fontGroups", () => {
  it("leads with monospace for the mono slot and sans elsewhere", () => {
    expect(fontGroups("mono")[0].role).toBe("mono");
    expect(fontGroups("body")[0].role).toBe("sans");
    expect(fontGroups("display")[0].role).toBe("sans");
  });

  /**
   * Every slot offers the whole library. A tenant wanting a mono display face
   * is unusual, not wrong, and a picker that hides options is harder to explain
   * than one that orders them.
   */
  it("offers the full library in every slot", () => {
    for (const slot of ["display", "body", "mono"] as const) {
      expect(fontGroups(slot).flatMap((g) => g.fonts)).toHaveLength(15);
    }
  });
});

describe("fontByValue", () => {
  it("round-trips a stack this library produced", () => {
    for (const f of FONTS) expect(fontByValue(f.stack)?.id).toBe(f.id);
  });

  /**
   * THE MIGRATION CASE. Before the library, Appearance was a free-text box, and
   * the tenant in the screenshot that prompted this work had typed
   * `"Montserrat", Georgia, serif`. No Montserrat was bundled, so browsers fell
   * through to Georgia and the preview cheerfully said "Montserrat". Resolving
   * that string to the real family is what makes the existing data correct
   * rather than merely preserved.
   */
  it("resolves a hand-typed legacy stack to its family", () => {
    expect(fontByValue('"Montserrat", Georgia, serif')?.id).toBe("montserrat");
    expect(fontByValue("Montserrat")?.id).toBe("montserrat");
    expect(fontByValue("JetBrains Mono, monospace")?.id).toBe("jetbrains-mono");
    expect(fontByValue("  inter  ")?.id).toBe("inter");
  });

  it("returns nothing for an unset or genuinely custom stack", () => {
    expect(fontByValue("")).toBeUndefined();
    expect(fontByValue(null)).toBeUndefined();
    expect(fontByValue(undefined)).toBeUndefined();
    expect(fontByValue('"Acme Grotesk", sans-serif')).toBeUndefined();
  });

  it("does not match on a fallback — Georgia is not a library pick", () => {
    expect(fontByValue("Georgia, serif")).toBeUndefined();
  });
});

describe("loading", () => {
  it("requests a family once however many callers ask", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const font = { ...FONTS[0], load };
    await Promise.all([loadFont(font), loadFont(font), loadFont(font)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  /**
   * A chunk that failed offline must be retryable. Caching the rejection would
   * mean a user who opened Appearance on a dead connection never saw their
   * fonts again for the life of the tab.
   */
  it("does not cache a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const font = { ...FONTS[0], load };
    await expect(loadFont(font)).rejects.toThrow("offline");
    await expect(loadFont(font)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  /**
   * The startup path. A session must pull the families actually in force, not
   * the fifteen in the library — that is the whole lazy-loading decision.
   */
  it("loads only the families the active stacks name", async () => {
    const loaded: string[] = [];
    const spies = FONTS.map((f) => vi.spyOn(f, "load").mockImplementation(async () => void loaded.push(f.id)));
    await loadFonts(['"Montserrat Variable", "Montserrat", sans-serif', "Lora", null, "", '"Acme", sans-serif']);
    expect(loaded.sort()).toEqual(["lora", "montserrat"]);
    spies.forEach((s) => s.mockRestore());
  });

  it("de-duplicates when two slots share a family", async () => {
    const inter = FONTS.find((f) => f.id === "inter")!;
    const spy = vi.spyOn(inter, "load").mockResolvedValue(undefined);
    await loadFonts([inter.stack, inter.stack, "Inter"]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  /**
   * Boot must not depend on the network. A font chunk failing has to leave the
   * caller's promise resolved — the fallback stack still renders readable text,
   * and a rejected boot would blank the app over a preference.
   */
  it("never rejects, so a failed chunk cannot break boot", async () => {
    const inter = FONTS.find((f) => f.id === "inter")!;
    const spy = vi.spyOn(inter, "load").mockRejectedValue(new Error("offline"));
    await expect(loadFonts([inter.stack])).resolves.toBeDefined();
    spy.mockRestore();
  });
});

describe("fontById", () => {
  it("finds a known id and nothing else", () => {
    expect(fontById("lato")?.name).toBe("Lato");
    expect(fontById("nope")).toBeUndefined();
    expect(fontById(null)).toBeUndefined();
  });
});
