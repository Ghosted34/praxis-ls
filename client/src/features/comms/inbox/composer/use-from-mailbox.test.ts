/**
 * The sender-mailbox rule, on its own.
 *
 * The composer cannot be mounted in jsdom (TipTap brings a real ProseMirror
 * DOM and the ranges jsdom does not implement — see composer.test.tsx), which
 * is exactly how a one-line `useState` seed shipped a silent wrong-sender bug:
 * nothing in the suite could see the state that decided who a message came
 * from. So the rule lives in a hook, and the hook has a suite.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFromMailbox } from "./use-from-mailbox";

describe("useFromMailbox", () => {
  it("starts on the mailbox the caller decided", () => {
    const { result } = renderHook(() => useFromMailbox("c-default"));
    expect(result.current[0]).toBe("c-default");
  });

  it("FOLLOWS THE CALLER WHEN THE CALLER CHANGES ITS MIND — the whole bug", () => {
    // `new-message.tsx` owns the picker for a new message and changes this prop
    // without remounting. Seeded-once state meant every message left from the
    // mailbox the dialog opened on, however carefully the operator picked.
    const { result, rerender } = renderHook(({ id }) => useFromMailbox(id), {
      initialProps: { id: "c-default" },
    });
    rerender({ id: "c-billing" });
    expect(result.current[0]).toBe("c-billing");
  });

  it("does not overwrite a choice made in the composer's own From row", () => {
    // The composer re-renders constantly — every keystroke autosaves, every
    // recipient check settles. A re-render carrying the same prop is not a new
    // decision, and treating it as one would snap the sender back mid-message.
    const { result, rerender } = renderHook(({ id }) => useFromMailbox(id), {
      initialProps: { id: "c-default" },
    });
    act(() => result.current[1]("c-billing"));
    rerender({ id: "c-default" });
    expect(result.current[0]).toBe("c-billing");
  });

  it("ignores an empty decision rather than clearing the sender", () => {
    // A parent still loading its mailbox list passes "" for a tick.
    const { result, rerender } = renderHook(({ id }) => useFromMailbox(id), {
      initialProps: { id: "c-billing" },
    });
    rerender({ id: "" });
    expect(result.current[0]).toBe("c-billing");
  });
});
