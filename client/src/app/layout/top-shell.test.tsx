/**
 * The title bar strip — the two things about it that are invisible until they
 * are broken, and are then broken on a customer's desktop rather than in CI.
 *
 * 1. DRAG REGIONS. `.wco` sets `-webkit-app-region: drag` on the whole strip so
 *    the window can be moved by grabbing it, and every interactive descendant
 *    has to opt back out. Get that wrong in one direction and a button silently
 *    drags the window instead of doing its job; get it wrong in the other — no
 *    drag region at all — and the window cannot be moved by its title bar,
 *    which is worse, because there is no other way to move it.
 *
 *    That rule lives in CSS (`:is(button, a, input, …)`), which means jsdom
 *    cannot evaluate it: no stylesheet is loaded, so `getComputedStyle` reports
 *    nothing useful. So this test asserts the SHAPE the rule depends on —
 *    that every interactive element in the strip is a selector the rule
 *    matches — rather than the computed value. A control added as a `<div
 *    onClick>` would pass an interaction test and fail this one, correctly:
 *    it is exactly the element that would become undraggable and unclickable.
 *
 * 2. IT DEGRADES. WCO exists only in an installed desktop window. In a browser
 *    tab, and on every mobile browser, `env(titlebar-area-*)` is undefined and
 *    the strip must render as an ordinary bar with every control reachable.
 *    jsdom has no WCO either, so the default render IS the degraded case —
 *    which makes "everything is present and reachable here" the assertion.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { within } from "@testing-library/react";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

// The shell reads branding for the app name and the title bar treatment. Faked
// rather than wrapped in the real provider so the test stays about the strip's
// structure and never waits on the public /branding fetch.
vi.mock("@/app/branding/branding-context", async () => {
  const { effectivePwa, EMPTY_PWA_CONFIG } =
    await vi.importActual<typeof import("@/lib/pwa-config")>("@/lib/pwa-config");
  const branding = { name: "Acme Freight", primary: "#1188ff", primaryForeground: "#fff", logoUrl: null };
  return {
    useBranding: () => ({
      branding,
      setBranding: vi.fn(),
      ready: true,
      pwa: effectivePwa(EMPTY_PWA_CONFIG, branding),
      pwaConfig: EMPTY_PWA_CONFIG,
      setPwaConfig: vi.fn(),
      userAppearance: {},
      setUserAppearance: vi.fn(),
    }),
    BrandingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { AppShell } from "./app-shell";

/** Selectors the `.wco` no-drag rule in index.css covers. Kept in step with it
 *  deliberately: if someone narrows the CSS, this list is where they will see
 *  what it was protecting. */
const NO_DRAG_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"]), .no-drag';

/** Anything a user can operate. Broader than the rule above on purpose — the
 *  difference between the two sets is precisely the bug this test looks for. */
const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [onclick]';

// jsdom implements no `matchMedia`, and the theme toggle in the strip asks for
// the OS colour preference on mount. Stubbed rather than mocking theme-mode, so
// the real toggle renders and is counted by the drag-region assertions.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

/**
 * `renderScreen`, not a hand-rolled `render(<MemoryRouter>…)`.
 *
 * A router alone is not enough to mount AppShell. `useUnreadCounts` calls
 * `useQueryClient()`, which throws "No QueryClient set, use QueryClientProvider
 * to set one" — and it throws during render, so all six tests in this file died
 * before asserting anything about the strip.
 *
 * The harness exists for precisely this and its own comment predicted it: it
 * mounts THE APP'S ROOT PROVIDERS — QueryClient, Toast, Tooltip, router — after
 * the journal-entry form lost four assertions to a missing ToastProvider. A
 * shell is the component most likely to reach for any of them, so anything that
 * renders one should go through the harness rather than assemble a subset of it
 * and discover which piece is missing one hook at a time.
 *
 * The api-client fake is already installed at module level above; with no
 * fixtures declared, `resolveFixture` answers every path with `[]`, so the
 * unread-count queries resolve empty and the strip renders its default state.
 */
function renderShell() {
  return renderScreen(<AppShell />);
}

describe("title bar strip", () => {
  it("renders as the app's utility bar where there is no window to overlay", () => {
    // jsdom implements no WCO, which is the same situation as a browser tab and
    // as every mobile browser. Nothing may be conditional on the overlay
    // existing.
    const { container } = renderShell();
    const strip = container.querySelector(".wco");
    expect(strip).not.toBeNull();
    expect(strip).toBeVisible();
  });

  it("carries the surface and artwork layers the tenant's settings drive", () => {
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;
    expect(strip.classList.contains("wco-surface")).toBe(true);
    // The artwork plane must exist even with no image configured — it is driven
    // by a CSS variable, so it is present and transparent rather than mounted
    // conditionally. A conditional mount would mean setting an image needed a
    // re-render rather than a variable write.
    expect(strip.querySelector(".wco-art")).not.toBeNull();
  });

  it("gives every interactive control in the strip a no-drag selector", () => {
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;

    const interactive = Array.from(strip.querySelectorAll(INTERACTIVE_SELECTOR));
    // Guard against the assertion passing because nothing rendered.
    expect(interactive.length).toBeGreaterThan(2);

    const undraggable = interactive.filter((el) => !el.matches(NO_DRAG_SELECTOR));
    expect(
      undraggable.map((el) => `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`),
    ).toEqual([]);
  });

  it("leaves an area with no controls in it, so the window can still be dragged", () => {
    // A strip packed edge to edge with buttons is a window that cannot be moved.
    // The spacer is load-bearing, not decoration.
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;
    const spacers = Array.from(strip.children).filter(
      (el) => el.querySelectorAll(INTERACTIVE_SELECTOR).length === 0 && el.classList.contains("flex-1"),
    );
    expect(spacers.length).toBeGreaterThan(0);
  });

  it("keeps the utility controls reachable after the move out of the nav row", () => {
    const { container } = renderShell();
    // Scoped to the strip, not the document: BottomNav carries its own Search
    // for `< md`, so a document-wide query would match either and pass even if
    // the strip's copy had been dropped in a restructure — which is the exact
    // regression this is here to catch.
    const strip = within(container.querySelector<HTMLElement>(".wco")!);
    expect(strip.getByRole("group", { name: "Data environment" })).toBeInTheDocument();
    expect(strip.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("mounts the icon rail beside the content, not inside the strip", () => {
    // The rail is app-level chrome with its own contents; nesting it in the
    // title bar would make it read as part of the window furniture and would
    // put it inside the drag region.
    const { container } = renderShell();
    const rail = container.querySelector(".rail");
    expect(rail).not.toBeNull();
    expect(container.querySelector(".wco")!.contains(rail)).toBe(false);
  });

  it("is free of accessibility violations", async () => {
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;
    expect(await axe(strip)).toHaveNoViolations();
  });
});
