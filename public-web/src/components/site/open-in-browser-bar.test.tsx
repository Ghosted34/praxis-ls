import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import { OpenInBrowserBar } from "./open-in-browser-bar";

function setDisplayMode(mode: string) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === `(display-mode: ${mode})`,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("OpenInBrowserBar", () => {
  it("is not shown in an ordinary browser tab", () => {
    setDisplayMode("browser");
    render(<OpenInBrowserBar />);
    expect(screen.queryByTestId("open-in-browser-bar")).toBeNull();
  });

  it("is shown when the page was captured into an installed app window", () => {
    setDisplayMode("standalone");
    render(<OpenInBrowserBar />);
    expect(screen.getByTestId("open-in-browser-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in browser" })).toBeInTheDocument();
  });

  it("on desktop, opens the current page in a new browser window", () => {
    setDisplayMode("window-controls-overlay");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0) Chrome/128");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<OpenInBrowserBar />);
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(open).toHaveBeenCalledWith(window.location.href, "_blank", "noopener");
  });

  it("can be dismissed", () => {
    setDisplayMode("standalone");
    render(<OpenInBrowserBar />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("open-in-browser-bar")).toBeNull();
  });
});
