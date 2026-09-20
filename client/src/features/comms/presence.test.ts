/**
 * Presence (PR-1) — the live-dot store and the day-first last-seen text.
 *
 * The text is a HOUSE date (guide §4.11, day-first, EN and FR both checked
 * here because those are the only two principal languages) and the dot is a
 * socket fact, not a timestamp — the two halves are asserted separately so a
 * future edit cannot quietly turn the dot into "was online five minutes ago".
 */
import { describe, it, expect, afterAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { setOnline, useOnline, lastSeenText } from "./presence";

/** Noon UTC today/yesterday/N days ago — noon never crosses a date line in
 *  the pinned test zone, so "today"/"yesterday" are stable assertions. */
function atUtcDaysAgo(days: number): string {
  const now = new Date();
  const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  return new Date(noon - days * 86_400_000).toISOString();
}

function dmyUtc(iso: string): string {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

describe("lastSeenText", () => {
  afterAll(() => {
    void i18n.changeLanguage("en");
  });

  it("EN: today, yesterday, and older in the house day-first form", () => {
    expect(lastSeenText(atUtcDaysAgo(0))).toBe("Last seen today at 12:00");
    expect(lastSeenText(atUtcDaysAgo(1))).toBe("Last seen yesterday at 12:00");
    const older = atUtcDaysAgo(4);
    expect(lastSeenText(older)).toBe(`Last seen ${dmyUtc(older)} at 12:00`);
  });

  it("FR: the same three shapes, in French", async () => {
    await i18n.changeLanguage("fr");
    expect(lastSeenText(atUtcDaysAgo(0))).toBe("Vu aujourd'hui à 12:00");
    expect(lastSeenText(atUtcDaysAgo(1))).toBe("Vu hier à 12:00");
    const older = atUtcDaysAgo(4);
    expect(lastSeenText(older)).toBe(`Vu le ${dmyUtc(older)} à 12:00`);
    await i18n.changeLanguage("en");
  });

  it("never-invented: no timestamp renders nothing, and a bad one does too", () => {
    expect(lastSeenText(null)).toBe("");
    expect(lastSeenText(undefined)).toBe("");
    expect(lastSeenText("not-a-date")).toBe("");
  });

  it("the older form is DAY-FIRST (the house rule, not Intl's en-US)", () => {
    const older = atUtcDaysAgo(4);
    const out = lastSeenText(older);
    const m = out.match(/Last seen (\d{2})\/(\d{2})\/(\d{4}) at/);
    expect(m).not.toBeNull();
    const d = new Date(older);
    expect(Number(m?.[1])).toBe(d.getUTCDate());
    expect(Number(m?.[2])).toBe(d.getUTCMonth() + 1);
  });
});

describe("the live dot store", () => {
  it("a user's first socket is online, the last is not", () => {
    const { result } = renderHook(() => useOnline("u1"));
    act(() => setOnline("u1", true));
    expect(result.current).toBe(true);
    act(() => setOnline("u1", false));
    expect(result.current).toBe(false);
  });

  it("one user's presence never moves another's", () => {
    const a = renderHook(() => useOnline("a"));
    const b = renderHook(() => useOnline("b"));
    act(() => setOnline("a", true));
    expect(a.result.current).toBe(true);
    expect(b.result.current).toBe(false);
  });

  it("an unchanged update is a no-op (the socket may re-send)", () => {
    const { result } = renderHook(() => useOnline("u2"));
    expect(result.current).toBe(false);
    act(() => setOnline("u2", true));
    expect(result.current).toBe(true);
    act(() => setOnline("u2", true)); // same value — the store keeps its object
    expect(result.current).toBe(true);
    act(() => setOnline("u2", false));
    expect(result.current).toBe(false);
  });
});
