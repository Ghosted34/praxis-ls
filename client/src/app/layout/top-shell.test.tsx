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
  // A LOGO, deliberately. `effectivePwa` falls back to the brand logo when a
  // tenant has not uploaded a dedicated app icon — which is the common case and
  // the one the title bar got wrong, so it is the case these tests default to.
  // The logo is a wide lockup; the strip must not render it as one.
  const branding = {
    name: "Acme Freight",
    primary: "#1188ff",
    primaryForeground: "#fff",
    logoUrl: "/media/tenant_acme/branding/wordmark.png",
  };
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

  /**
   * THE IDENTITY IS THE APP ICON AND THE APP NAME, not the tenant wordmark.
   *
   * A wide lockup in a 44px bar shrinks until its tagline is unreadable and
   * crowds the row it shares with the window controls — which is what the first
   * version did. Native desktop apps all resolve this the same way: a square
   * mark plus plain text. It also keeps the window self-consistent, because the
   * icon here is the same artwork the OS shows in the taskbar.
   *
   * Pinned because the failure is purely visual: swapping back to `Brand` would
   * render, pass every other test, and simply look wrong.
   */
  it("shows the app name as text, not only a logo image", () => {
    const { container } = renderShell();
    const strip = container.querySelector<HTMLElement>(".wco")!;
    // `Brand` renders the logo INSTEAD of the name when a tenant has one, so a
    // revert leaves the bar with no readable name at all. This is that check.
    expect(within(strip).getByText("Acme Freight")).toBeInTheDocument();
  });

  /**
   * THE FALLBACK IS THE TRAP. `effectivePwa` resolves `iconUrl` to the brand
   * logo when no dedicated app icon is set, so the naive `<img src={iconUrl}>`
   * puts a wide wordmark in a 20px slot — squashed, or worse, laid out at its
   * natural width and pushing the row apart. Composited through `AppIcon` it is
   * contained inside a fixed square, exactly as sharp composites the PNG the
   * taskbar shows.
   */
  it("contains the icon in a fixed square box, so a wide logo cannot stretch the bar", () => {
    const { container } = renderShell();
    const strip = container.querySelector<HTMLElement>(".wco")!;
    const img = within(strip).getAllByRole("presentation", { hidden: true })[0] as HTMLImageElement;
    expect(img.src).toContain("wordmark.png");

    const box = img.parentElement!;
    expect(box.style.width).toBe(box.style.height);
    expect(box).toHaveClass("overflow-hidden");
    expect(img.style.objectFit).toBe("contain");
  });

  it("gives the icon an empty alt, so the name is not announced twice", () => {
    // The name sits beside it as real text. An alt here would make a screen
    // reader read "Acme Freight Acme Freight" — which is what `Brand` does,
    // since it labels the logo with the tenant name.
    const { container } = renderShell();
    const strip = container.querySelector<HTMLElement>(".wco")!;
    for (const img of Array.from(strip.querySelectorAll("img"))) {
      expect(img.getAttribute("alt")).toBe("");
    }
  });

  it("is free of accessibility violations", async () => {
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;
    expect(await axe(strip)).toHaveNoViolations();
  });
});
