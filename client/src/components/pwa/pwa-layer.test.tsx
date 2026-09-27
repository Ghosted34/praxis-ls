import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The layer's children have their own suites; here only WHICH of them mount matters.
vi.mock("./install-banner", () => ({ InstallBanner: () => <div data-testid="install-banner" /> }));
vi.mock("./pwa-updater", () => ({ PwaUpdater: () => <div data-testid="pwa-updater" /> }));
vi.mock("./offline-indicator", () => ({ OfflineIndicator: () => <div data-testid="offline-indicator" /> }));
vi.mock("./push-sync", () => ({ PushSync: () => null }));
vi.mock("./push-enrolment-banner", () => ({ PushEnrolmentBanner: () => <div data-testid="push-banner" /> }));
vi.mock("@/components/connection/connection-watcher", () => ({ ConnectionWatcher: () => null }));

import { PwaLayer } from "./pwa-layer";

let mode = "browser";
beforeEach(() => {
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
});
afterEach(() => {
  mode = "browser";
});

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PwaLayer />
    </MemoryRouter>,
  );

describe("PwaLayer on pages for strangers", () => {
  it("does not offer to install the staff app on a signing link", () => {
    at("/sign/tok123");
    expect(screen.queryByTestId("install-banner")).toBeNull();
    expect(screen.queryByTestId("push-banner")).toBeNull();
    expect(screen.queryByTestId("pwa-updater")).toBeNull();
    expect(screen.getByTestId("offline-indicator")).toBeInTheDocument();
  });

  it("offers the way out when the link was captured into the installed app", () => {
    mode = "standalone";
    at("/v/ABCD1234EFGH");
    expect(screen.getByTestId("open-in-browser-bar")).toBeInTheDocument();
  });

  it("shows no bar in an ordinary browser tab", () => {
    at("/sign/tok123");
    expect(screen.queryByTestId("open-in-browser-bar")).toBeNull();
  });
});

describe("PwaLayer on staff routes", () => {
  it("keeps the install banner, updater and push prompt, and never the bar", () => {
    mode = "standalone";
    at("/sales/quotes");
    expect(screen.getByTestId("install-banner")).toBeInTheDocument();
    expect(screen.getByTestId("pwa-updater")).toBeInTheDocument();
    expect(screen.getByTestId("push-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("open-in-browser-bar")).toBeNull();
  });
});
