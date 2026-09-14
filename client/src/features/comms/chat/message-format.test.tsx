import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseMessage, serializeMessage } from "./message-format";
import { MessageText } from "./message-text";
import { scheduleInstant } from "./schedule-time";

describe("chat list codec", () => {
  it.each([
    "Hello\nNext line",
    "1. First\n2. Second",
    "- First\n- Second",
    "- Parent\n  - Child\n- Sibling",
    "3. Third\n4. Fourth",
    "Text\n\n- A\n- B",
    "- One\n- ",
  ])("round trips %s", (body) => {
    expect(serializeMessage(parseMessage(body))).toBe(body);
  });
  it("normalizes asterisk bullets", () =>
    expect(serializeMessage(parseMessage("* A\n* B"))).toBe("- A\n- B"));
  it("renders semantic lists and never executes pasted HTML", () => {
    render(<MessageText body={"1. First\n2. <img src=x onerror=alert(1)>"} />);
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
  });
});
describe("schedule time", () => {
  it("refuses incomplete and past dates", () => {
    expect(scheduleInstant("")).toBeNull();
    expect(scheduleInstant("broken")).toBeNull();
    expect(scheduleInstant("2000-01-01T12:00")).toBeNull();
  });
});
