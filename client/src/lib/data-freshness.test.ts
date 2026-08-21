/**
 * The dial's arithmetic.
 *
 * Every one of these is a way for a freshness indicator to lie, and a lie here
 * is worse than no indicator at all: the whole proposition is that a glance at
 * the ring tells you whether the number beside it can be quoted.
 */
import { describe, it, expect, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { makeQueryClient } from "./query-client";
import { DRAIN_MS, freshnessFrom, oldestActiveUpdate } from "./data-freshness";

const T0 = 1_700_000_000_000;

describe("freshnessFrom", () => {
  it("reads full the moment data lands, and empty at the drain", () => {
    expect(freshnessFrom(T0, T0)).toBe(1);
    expect(freshnessFrom(T0 - DRAIN_MS / 2, T0)).toBeCloseTo(0.5, 5);
    expect(freshnessFrom(T0 - DRAIN_MS, T0)).toBe(0);
    // Past the drain it stays empty rather than going negative and inverting
    // the arc — the dial has no way to say "very stale indeed".
    expect(freshnessFrom(T0 - DRAIN_MS * 10, T0)).toBe(0);
  });

  it("reads full when there is nothing to measure", () => {
    // A settings screen fetches nothing. Draining its dial would be fiction,
    // and a user who acted on it would be acting on invented information.
    expect(freshnessFrom(null, T0)).toBe(1);
  });

  it("clamps a timestamp from the future", () => {
    // Clock skew between the browser and a `dataUpdatedAt` stamped elsewhere;
    // rare, but it would otherwise produce a fraction above 1 and an arc drawn
    // past its own circumference.
    expect(freshnessFrom(T0 + 60_000, T0)).toBe(1);
  });
});

describe("oldestActiveUpdate", () => {
  it("reports the stalest thing on screen, not the freshest", async () => {
    const qc = makeQueryClient();
    const obsA = new QueryObserver(qc, {
      queryKey: ["a"],
      queryFn: () => Promise.resolve(1),
    });
    const obsB = new QueryObserver(qc, {
      queryKey: ["b"],
      queryFn: () => Promise.resolve(2),
    });
    const stop = [obsA.subscribe(() => {}), obsB.subscribe(() => {})];
    await vi.waitFor(() => expect(qc.getQueryData(["b"])).toBe(2));

    qc.setQueryData(["a"], 1, { updatedAt: T0 - 5 * 60_000 });
    qc.setQueryData(["b"], 2, { updatedAt: T0 - 30_000 });

    // A dossier with a fresh header and a forty-minute-old cost roll-up is a
    // forty-minute-old dossier. Reporting the header's age would be the
    // comfortable answer and the wrong one.
    expect(oldestActiveUpdate(qc)).toBe(T0 - 5 * 60_000);
    stop.forEach((s) => s());
    qc.clear();
  });

  it("ignores cache entries nothing is looking at", async () => {
    const qc = makeQueryClient();
    const obs = new QueryObserver(qc, {
      queryKey: ["visible"],
      queryFn: () => Promise.resolve(1),
    });
    const stop = obs.subscribe(() => {});
    await vi.waitFor(() => expect(qc.getQueryData(["visible"])).toBe(1));

    qc.setQueryData(["visible"], 1, { updatedAt: T0 - 60_000 });
    // Left warm by a screen the user has since left — `gcTime` keeps it for
    // five minutes. It is not on screen, so it is not what the dial measures.
    qc.setQueryData(["abandoned"], 9, { updatedAt: T0 - 60 * 60_000 });

    expect(oldestActiveUpdate(qc)).toBe(T0 - 60_000);
    stop();
    qc.clear();
  });

  it("does not count a first fetch that has not landed as epoch zero", () => {
    const qc = makeQueryClient();
    // A query mounted and still in flight has dataUpdatedAt === 0. Treating
    // that as a timestamp reports the screen as fifty-six years stale for as
    // long as its first request is open — which is precisely the moment a
    // freshness indicator is most likely to be looked at.
    const obs = new QueryObserver(qc, {
      queryKey: ["pending"],
      queryFn: () => new Promise<number>(() => {}),
    });
    const stop = obs.subscribe(() => {});
    expect(oldestActiveUpdate(qc)).toBeNull();
    stop();
    qc.clear();
  });
});
