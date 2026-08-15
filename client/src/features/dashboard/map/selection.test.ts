/**
 * Selection, keyboard order, fitting and clustering.
 *
 * Every case here is a behaviour that would otherwise only ever be verified by
 * looking at the screen — which is how the previous map's interaction bugs
 * survived: there were no interactions to break. Each function encodes a decision
 * with an argument behind it, and the argument is in the comment above the test.
 */
import { describe, expect, it } from "vitest";
import type { Lane } from "../model";
import {
  boundsOf,
  clusterNodes,
  focusOrder,
  isSelected,
  labelOffset,
  lanesOfFile,
  nextSelection,
  stepFocus,
  type PlacedNode,
} from "./selection";

const lane = (
  over: Partial<Lane> & { id: string; dossierId: string },
): Lane => ({
  ref: `REF-${over.dossierId}`,
  mode: "sea",
  status: "In transit",
  legType: "MAIN_CARRIAGE",
  seq: 1,
  from: { name: "A", lat: 0, lng: 0 },
  to: { name: "B", lat: 10, lng: 10 },
  ...over,
});

/** An end-to-end file: five legs, one file. */
const END_TO_END: Lane[] = [
  lane({
    id: "f1:3",
    dossierId: "f1",
    seq: 3,
    legType: "INLAND_TRANSIT",
    mode: "road",
  }),
  lane({
    id: "f1:1",
    dossierId: "f1",
    seq: 1,
    legType: "PICKUP",
    mode: "road",
  }),
  lane({
    id: "f1:2",
    dossierId: "f1",
    seq: 2,
    legType: "MAIN_CARRIAGE",
    mode: "sea",
  }),
];

const TWO_FILES: Lane[] = [
  lane({ id: "b:1", dossierId: "b", ref: "REF-b" }),
  lane({ id: "a:1", dossierId: "a", ref: "REF-a" }),
];

describe("nextSelection", () => {
  it("selects a file that was not selected", () => {
    expect(nextSelection(null, "f1")).toBe("f1");
    expect(nextSelection("f2", "f1")).toBe("f1");
  });

  it("clicking the selected file again clears it", () => {
    // Selection DIMS every other route. Without a way back, an operator who
    // clicked a lane to read it has no obvious route to the whole picture again,
    // and the only recovery is a page reload.
    expect(nextSelection("f1", "f1")).toBeNull();
  });
});

describe("lanesOfFile", () => {
  it("returns the file's legs in itinerary order, whatever order they arrived in", () => {
    expect(lanesOfFile(END_TO_END, "f1").map((l) => l.legType)).toEqual([
      "PICKUP",
      "MAIN_CARRIAGE",
      "INLAND_TRANSIT",
    ]);
  });

  it("is empty for no selection", () => {
    expect(lanesOfFile(END_TO_END, null)).toEqual([]);
  });

  it("is empty for a file that is not on the map", () => {
    expect(lanesOfFile(END_TO_END, "nope")).toEqual([]);
  });
});

describe("isSelected", () => {
  it("selects a whole FILE, not the leg that was clicked", () => {
    // An operator clicks the sea leg because they want the file — the truck that
    // has not collected yet is the thing they are about to ask about, and dimming
    // it because they clicked a different segment would hide the answer.
    const pickup = END_TO_END.find((l) => l.legType === "PICKUP")!;
    const carriage = END_TO_END.find((l) => l.legType === "MAIN_CARRIAGE")!;
    expect(isSelected(pickup, "f1")).toBe(true);
    expect(isSelected(carriage, "f1")).toBe(true);
  });

  it("nothing is selected when the selection is null", () => {
    expect(isSelected(END_TO_END[0], null)).toBe(false);
  });
});

describe("focusOrder", () => {
  it("has one stop per file, not one per leg", () => {
    // Five legs per file would make a twelve-file map forty presses wide, and the
    // keyboard would stop being a way to get anywhere.
    expect(focusOrder(END_TO_END)).toEqual(["f1"]);
  });

  it("is stable and total — same data, same order", () => {
    expect(focusOrder(TWO_FILES)).toEqual(["a", "b"]);
    expect(focusOrder([...TWO_FILES].reverse())).toEqual(["a", "b"]);
  });

  it("is empty with nothing to walk", () => {
    expect(focusOrder([])).toEqual([]);
  });
});

describe("stepFocus", () => {
  const order = ["a", "b", "c"];

  it("moves forward and backward", () => {
    expect(stepFocus(order, "a", 1)).toBe("b");
    expect(stepFocus(order, "b", -1)).toBe("a");
  });

  it("wraps at both ends rather than stopping", () => {
    // The map is a ring of routes, not a list with a bottom, and a key that
    // silently does nothing at the last item reads as broken.
    expect(stepFocus(order, "c", 1)).toBe("a");
    expect(stepFocus(order, "a", -1)).toBe("c");
  });

  it("starts at the first going forward and the last going back", () => {
    expect(stepFocus(order, null, 1)).toBe("a");
    expect(stepFocus(order, null, -1)).toBe("c");
  });

  it("survives a selection that is no longer on the map", () => {
    // A filter can remove the selected file between renders.
    expect(stepFocus(order, "gone", 1)).toBe("a");
  });

  it("is null when there is nothing to focus", () => {
    expect(stepFocus([], "a", 1)).toBeNull();
  });
});

describe("boundsOf", () => {
  it("boxes every endpoint", () => {
    expect(
      boundsOf([
        lane({
          id: "1",
          dossierId: "x",
          from: { name: "a", lat: -5, lng: 20 },
          to: { name: "b", lat: 40, lng: -3 },
        }),
      ]),
    ).toEqual({ minLon: -3, maxLon: 20, minLat: -5, maxLat: 40 });
  });

  it("is null for nothing to bound, so the caller can say so", () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe("clusterNodes", () => {
  const node = (
    x: number,
    y: number,
    name: string,
    emphasis = false,
  ): PlacedNode => ({ x, y, name, emphasis });

  it("collapses markers that land on top of each other", () => {
    // Douala, Douala Airport, Kribi and Limbe are four distinct places that
    // project into the same forty pixels at an Atlantic zoom.
    const out = clusterNodes(
      [node(100, 100, "Douala"), node(104, 103, "Douala Airport")],
      14,
    );
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].names).toEqual(["Douala", "Douala Airport"]);
  });

  it("keeps the FIRST node's position, not the centroid", () => {
    // An averaged pin sits in the sea between two ports and points at neither.
    const out = clusterNodes(
      [node(100, 100, "Douala"), node(110, 100, "Kribi")],
      14,
    );
    expect(out[0].x).toBe(100);
  });

  it("leaves distant markers alone", () => {
    expect(
      clusterNodes([node(0, 0, "A"), node(500, 300, "B")], 14),
    ).toHaveLength(2);
  });

  it("a cluster containing a destination is drawn as one", () => {
    // Losing a terminus into a waypoint is the wrong way round to drop info.
    const out = clusterNodes(
      [node(100, 100, "Waypoint", false), node(102, 101, "Terminus", true)],
      14,
    );
    expect(out[0].emphasis).toBe(true);
  });

  it("does not repeat a name that appears twice", () => {
    const out = clusterNodes(
      [node(100, 100, "Douala"), node(101, 101, "Douala")],
      14,
    );
    expect(out[0].names).toEqual(["Douala"]);
    expect(out[0].count).toBe(2);
  });

  it("an ordinary marker reports a count of 1", () => {
    expect(clusterNodes([node(0, 0, "A")], 14)[0]).toMatchObject({
      count: 1,
      names: ["A"],
    });
  });
});

describe("labelOffset", () => {
  it("is zero when nothing is in the way", () => {
    expect(labelOffset([], 100, 100)).toBe(0);
  });

  it("nudges clear of a label already placed", () => {
    expect(labelOffset([{ x: 100, y: 100, dy: 0 }], 110, 104)).not.toBe(0);
  });

  it("alternates up and down so a run fans out instead of drifting", () => {
    const placed = [{ x: 100, y: 100, dy: 0 }];
    const first = labelOffset(placed, 100, 100);
    placed.push({ x: 100, y: 100, dy: first });
    const second = labelOffset(placed, 100, 100);
    expect(Math.sign(first)).not.toBe(Math.sign(second));
  });

  it("gives up rather than looping forever on a dense cluster", () => {
    const placed = Array.from({ length: 40 }, (_, i) => ({
      x: 100,
      y: 100 + i,
      dy: 0,
    }));
    expect(Number.isFinite(labelOffset(placed, 100, 100))).toBe(true);
  });
});
