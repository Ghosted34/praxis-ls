/**
 * The workspace search box — the one control the Tasks page and the Calendar
 * share. What is proved: it is a labelled search input, it reports a typed
 * value ONCE after the debounce rather than per keystroke, the clear button
 * and Escape both empty it and report at once, and a value changed from
 * outside (a cleared URL filter) is followed without being re-reported.
 */
import * as React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { axe } from "jest-axe";
import { SearchField } from "./search-field";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({ onChange, initial = "", delay = 250 }: { onChange: (q: string) => void; initial?: string; delay?: number }) {
  const [value, setValue] = React.useState(initial);
  return (
    <SearchField
      value={value}
      onChange={(q) => {
        setValue(q);
        onChange(q);
      }}
      label="Search tasks"
      placeholder="Search title, notes, file or client…"
      delay={delay}
    />
  );
}

describe("SearchField", () => {
  it("is a labelled search input inside a search landmark", async () => {
    const { container } = render(<Harness onChange={() => {}} />);
    const box = screen.getByRole("searchbox", { name: "Search tasks" });
    expect(box.getAttribute("type")).toBe("search");
    expect(screen.getByRole("search")).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("reports a typed word once, after the debounce, not once per keystroke", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(box, { target: { value: "b" } });
    fireEvent.change(box, { target: { value: "br" } });
    fireEvent.change(box, { target: { value: "bra" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("bra");
  });

  it("the clear button appears with a value, empties it at once and returns focus to the box", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="brasseries" />);
    const box = screen.getByRole("searchbox", { name: "Search tasks" }) as HTMLInputElement;
    expect(box.value).toBe("brasseries");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("Escape clears a non-empty box", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="SL3213" />);
    const box = screen.getByRole("searchbox", { name: "Search tasks" }) as HTMLInputElement;
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("follows a value changed from outside without re-reporting it", () => {
    const onChange = vi.fn();
    function Outer() {
      const [value, setValue] = React.useState("first");
      return (
        <>
          <button type="button" onClick={() => setValue("")}>
            reset
          </button>
          <SearchField value={value} onChange={(q) => { setValue(q); onChange(q); }} label="Search tasks" />
        </>
      );
    }
    render(<Outer />);
    const box = screen.getByRole("searchbox", { name: "Search tasks" }) as HTMLInputElement;
    expect(box.value).toBe("first");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(box.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
