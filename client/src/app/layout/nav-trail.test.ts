/**
 * The trail reducer, against the four ways a history stack actually moves.
 *
 * THE FAILURE THIS EXISTS TO CATCH is the one every hand-rolled back button
 * eventually ships: forward silently disappearing. It happens when a POP is
 * folded in as if it were a new destination, which truncates everything ahead
 * — and it is invisible in review, because back still works perfectly and the
 * forward arrow simply greys out a moment after you press back. So the cases
 * below are written in terms of what the BROWSER does to its stack (push
 * discards forward, replace does not, pop moves the cursor and touches
 * nothing), not in terms of what the app calls.
 *
 * `idx` in these tests is `window.history.state.idx` — React Router's own
 * monotonic stamp, and the thing the whole model is anchored on.
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_TRAIL,
  TRAIL_LIMIT,
  applyLocation,
  canGo,
  labelForPath,
  loadTrail,
  sameScreen,
  saveTrail,
  stepsFrom,
  targetOf,
  titleEntry,
  type NavKind,
  type Trail,
} from "./nav-trail";

/** One navigation, as the provider would fold it in. */
function visit(
  trail: Trail,
  idx: number,
  url: string,
  kind: NavKind = "PUSH",
  label = url,
): Trail {
  return applyLocation(trail, { idx, url, label }, kind);
}

/** Just the urls, in order, with the cursor marked — the shape every
 *  expectation below reads in one line. */
function shape(trail: Trail): string {
  return trail.entries
    .map((e, i) => (i === trail.at ? `[${e.url}]` : e.url))
    .join(" ");
}

describe("applyLocation", () => {
  it("records a first location", () => {
    const t = visit(EMPTY_TRAIL, 0, "/operations/files");
    expect(shape(t)).toBe("[/operations/files]");
    expect(canGo(t, -1)).toBe(false);
    expect(canGo(t, 1)).toBe(false);
  });

  it("appends pushes and lets the cursor walk back", () => {
    let t = visit(EMPTY_TRAIL, 0, "/");
    t = visit(t, 1, "/operations/files");
    t = visit(t, 2, "/operations/files?focus=abc");
    expect(shape(t)).toBe("/ /operations/files [/operations/files?focus=abc]");

    // Back once — the dossier closes and the Files tab is under it again.
    t = visit(t, 1, "/operations/files", "POP");
    expect(shape(t)).toBe("/ [/operations/files] /operations/files?focus=abc");
    expect(canGo(t, -1)).toBe(true);
    expect(canGo(t, 1)).toBe(true);
  });

  it("keeps the forward entries a POP moves past", () => {
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b");
    t = visit(t, 2, "/c");
    t = visit(t, 0, "/a", "POP");
    expect(shape(t)).toBe("[/a] /b /c");
    expect(targetOf(t, 1)?.url).toBe("/b");
    expect(targetOf(t, 2)?.url).toBe("/c");
  });

  it("discards the forward entries a PUSH invalidates", () => {
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b");
    t = visit(t, 2, "/c");
    t = visit(t, 1, "/b", "POP");
    // A new destination from here: the browser drops /c, and so must we —
    // offering a forward arrow `navigate(1)` cannot honour is the whole bug.
    t = visit(t, 2, "/d");
    expect(shape(t)).toBe("/a /b [/d]");
    expect(canGo(t, 1)).toBe(false);
  });

  it("rewrites in place on REPLACE, without losing what is ahead", () => {
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b?focus=1");
    t = visit(t, 2, "/c");
    t = visit(t, 1, "/b?focus=1", "POP");
    // Closing a record rewrites the url at the same stack position. `replace`
    // does not touch the browser's forward entries, so /c must survive.
    t = visit(t, 1, "/b", "REPLACE");
    expect(shape(t)).toBe("/a [/b] /c");
  });

  it("splices in a jump made outside our observation", () => {
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b");
    t = visit(t, 2, "/c");
    t = visit(t, 3, "/d");
    // The browser's own long-press menu, skipping two entries at once.
    t = visit(t, 1, "/b", "POP");
    expect(shape(t)).toBe("/a [/b] /c /d");
  });

  it("keeps a title a screen set, when the user walks back over it", () => {
    let t = visit(EMPTY_TRAIL, 0, "/operations/files");
    t = visit(t, 1, "/operations/files?focus=abc");
    t = titleEntry(t, "Dossier SLS-2481");
    t = visit(t, 0, "/operations/files", "POP");
    t = visit(t, 1, "/operations/files?focus=abc", "POP", "Files");
    // Not relabelled "Files" on the way past — the route can never know the
    // dossier's reference, so the stored name must win.
    expect(t.entries[1].label).toBe("Dossier SLS-2481");
    expect(t.entries[1].titled).toBe(true);
  });

  it("caps at TRAIL_LIMIT, dropping the oldest end", () => {
    let t = EMPTY_TRAIL;
    for (let i = 0; i < TRAIL_LIMIT + 8; i += 1) t = visit(t, i, `/p${i}`);
    expect(t.entries).toHaveLength(TRAIL_LIMIT);
    expect(t.at).toBe(TRAIL_LIMIT - 1);
    expect(t.entries[0].url).toBe("/p8");
    expect(t.entries[TRAIL_LIMIT - 1].url).toBe(`/p${TRAIL_LIMIT + 7}`);
  });

  it("never drops the entry the user is standing on", () => {
    // Build a full trail, then walk to its oldest end and keep going back into
    // territory we have already forgotten. The cursor must survive the trim.
    let t = EMPTY_TRAIL;
    for (let i = 0; i < TRAIL_LIMIT; i += 1) t = visit(t, i + 20, `/p${i}`);
    t = visit(t, 20, "/p0", "POP");
    t = visit(t, 5, "/older", "POP");
    expect(t.entries).toHaveLength(TRAIL_LIMIT);
    expect(t.entries[t.at].url).toBe("/older");
    expect(t.at).toBe(0);
  });
});

describe("stepsFrom", () => {
  it("lists each direction nearest first", () => {
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b");
    t = visit(t, 2, "/c");
    t = visit(t, 3, "/d");
    t = visit(t, 1, "/b", "POP");

    expect(stepsFrom(t, -1).map((s) => [s.entry.url, s.delta])).toEqual([
      ["/a", -1],
    ]);
    expect(stepsFrom(t, 1).map((s) => [s.entry.url, s.delta])).toEqual([
      ["/c", 1],
      ["/d", 2],
    ]);
  });

  it("is empty at either end", () => {
    const t = visit(EMPTY_TRAIL, 0, "/a");
    expect(stepsFrom(t, -1)).toEqual([]);
    expect(stepsFrom(t, 1)).toEqual([]);
  });
});

describe("labelForPath", () => {
  it("names an area by itself", () => {
    expect(labelForPath("/operations")).toEqual({ label: "Operations" });
  });

  it("names a section under its area", () => {
    expect(labelForPath("/operations/files")).toEqual({
      label: "Files",
      context: "Operations",
    });
  });

  it("names the Control Tower", () => {
    expect(labelForPath("/").label).toBe("Control Tower");
  });

  it("falls back to a readable slug off the map", () => {
    expect(labelForPath("/some-new-screen").label).toBe("Some new screen");
  });

  it("skips an id segment rather than showing a uuid", () => {
    expect(
      labelForPath("/master/entities/1b4e28ba-2fa1-11d2-883f-0016d3cca427")
        .label,
    ).not.toMatch(/1b4e28ba/);
  });
});

describe("sameScreen", () => {
  it("ignores the query", () => {
    expect(sameScreen("/operations/files", "/operations/files?focus=1")).toBe(
      true,
    );
    expect(sameScreen("/operations/files", "/operations/milestones")).toBe(
      false,
    );
  });
});

describe("session persistence", () => {
  /** A storage double — jsdom has sessionStorage, but the point here is that a
   *  throwing store must not take the trail (or the shell) down with it. */
  function store(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as Storage;
  }

  it("round-trips a trail", () => {
    const s = store();
    let t = visit(EMPTY_TRAIL, 0, "/a");
    t = visit(t, 1, "/b");
    saveTrail(t, s);
    expect(shape(loadTrail(s))).toBe(shape(t));
  });

  it("starts empty on a store that throws", () => {
    const angry = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(loadTrail(angry)).toEqual(EMPTY_TRAIL);
    expect(() => saveTrail(EMPTY_TRAIL, angry)).not.toThrow();
  });

  it("starts empty on a value it did not write", () => {
    const s = store();
    s.setItem("praxis.navTrail.v1", "{not json");
    expect(loadTrail(s)).toEqual(EMPTY_TRAIL);
  });

  it("drops malformed entries rather than rendering them", () => {
    const s = store();
    s.setItem(
      "praxis.navTrail.v1",
      JSON.stringify({ entries: [{ idx: 0, url: "/a" }, null, {}], at: 2 }),
    );
    const t = loadTrail(s);
    expect(t.entries).toHaveLength(1);
    // `at` clamped to what actually survived — an out-of-range cursor would
    // otherwise make both arrows disagree with the list behind them.
    expect(t.at).toBe(0);
  });
});
