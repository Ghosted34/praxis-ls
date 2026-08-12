/**
 * Form drafts.
 *
 * The reported bug was "I was filling a form, it means I have lost it", so the
 * first test is simply that it comes back. The rest are the ways a naive
 * autosave turns a rescue into a liability: writing a password to disk, offering
 * to restore a form nobody typed in, and dying when Safari refuses storage.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  saveDraft,
  readDraft,
  clearDraft,
  listDrafts,
  pruneDrafts,
} from "./form-draft";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => localStorage.clear());

describe("saveDraft / readDraft", () => {
  it("round-trips what the user typed", () => {
    saveDraft(
      "entity:new",
      { code: "SLAS", legal_name: "Smart Logistics" },
      { label: "Corporate entity" },
    );

    const back = readDraft<{ code: string; legal_name: string }>("entity:new");
    expect(back?.values).toEqual({
      code: "SLAS",
      legal_name: "Smart Logistics",
    });
    expect(back?.label).toBe("Corporate entity");
    expect(back?.savedAt).toBeTypeOf("number");
  });

  it("NEVER writes a credential-shaped field", () => {
    // localStorage is readable by any script on the origin and survives sign
    // out. A convenience that leaves a password there is a vulnerability.
    saveDraft("login", {
      email: "ops@example.com",
      password: "hunter2",
      confirm_password: "hunter2",
      api_key: "sk-live-123",
      otp: "483920",
      nested: { card_number: "4111111111111111", note: "keep me" },
    });

    const raw =
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.includes("login")) as string,
      ) || "";
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("sk-live-123");
    expect(raw).not.toContain("483920");
    expect(raw).not.toContain("4111111111111111");
    // The rest of the form is still rescued — redaction is per field, not a
    // reason to drop the draft.
    expect(raw).toContain("ops@example.com");
    expect(raw).toContain("keep me");
  });

  it("does not store an untouched form", () => {
    // Otherwise every screen the user merely OPENED offers to restore nothing,
    // and they learn to dismiss the prompt without reading it.
    saveDraft("entity:new", {
      code: "",
      legal_name: "",
      parent: null,
      tags: [],
    });
    expect(readDraft("entity:new")).toBeNull();
  });

  it("clears a stored draft when the form is emptied back out", () => {
    saveDraft("entity:new", { code: "SLAS" });
    expect(readDraft("entity:new")).not.toBeNull();
    saveDraft("entity:new", { code: "" });
    expect(readDraft("entity:new")).toBeNull();
  });

  it("expires a draft older than the TTL rather than offering stale work", () => {
    saveDraft("entity:old", { code: "OLD" });
    const key = Object.keys(localStorage).find((k) =>
      k.includes("entity:old"),
    ) as string;
    const stored = JSON.parse(localStorage.getItem(key) as string);
    stored.savedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(stored));

    expect(readDraft("entity:old")).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("drops a draft written by an older build instead of throwing", () => {
    const key = Object.keys(localStorage);
    saveDraft("entity:x", { code: "X" });
    const stored = Object.keys(localStorage).find(
      (k) => !key.includes(k),
    ) as string;
    localStorage.setItem(stored, "{not json");

    // A parse throw here would blank the screen that was trying to help.
    expect(() => readDraft("entity:x")).not.toThrow();
    expect(readDraft("entity:x")).toBeNull();
  });

  it("survives localStorage throwing on access (private-mode Safari)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    expect(() => saveDraft("entity:new", { code: "SLAS" })).not.toThrow();
    spy.mockRestore();
  });
});

describe("listDrafts / pruneDrafts", () => {
  it("lists live drafts newest first and prunes expired ones", () => {
    saveDraft("a", { code: "A" });
    saveDraft("b", { code: "B" });

    const listed = listDrafts();
    expect(listed).toHaveLength(2);
    expect(listed[0].savedAt).toBeGreaterThanOrEqual(listed[1].savedAt);

    const key = Object.keys(localStorage).find((k) =>
      k.includes(".a"),
    ) as string;
    const stored = JSON.parse(localStorage.getItem(key) as string);
    stored.savedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(stored));

    pruneDrafts();
    expect(listDrafts()).toHaveLength(1);
  });

  it("leaves other apps' localStorage keys alone", () => {
    localStorage.setItem("praxis.density", "comfortable");
    saveDraft("a", { code: "A" });
    pruneDrafts();
    clearDraft("a");
    expect(localStorage.getItem("praxis.density")).toBe("comfortable");
  });
});
