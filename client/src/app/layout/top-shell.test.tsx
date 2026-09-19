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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

// The shell reads branding for the app name and the title bar treatment. Faked
// rather than wrapped in the real provider so the test stays about the strip's
// structure and never waits on the public /branding fetch.
vi.mock("@/app/branding/branding-context", async () => {
  const { effectivePwa, EMPTY_PWA_CONFIG } =
    await vi.importActual<typeof import("@/lib/pwa-config")>(
      "@/lib/pwa-config",
    );
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
    BrandingProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
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

/** The shell at a given route — the chat workstation is the one that used to
 *  suppress the floating cluster. */
function renderShellAt(path: string) {
  return renderScreen(<AppShell />, { path });
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

    const interactive = Array.from(
      strip.querySelectorAll(INTERACTIVE_SELECTOR),
    );
    // Guard against the assertion passing because nothing rendered.
    expect(interactive.length).toBeGreaterThan(2);

    const undraggable = interactive.filter(
      (el) => !el.matches(NO_DRAG_SELECTOR),
    );
    expect(
      undraggable.map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}`,
      ),
    ).toEqual([]);
  });

  it("leaves an area with no controls in it, so the window can still be dragged", () => {
    // A strip packed edge to edge with buttons is a window that cannot be moved.
    // The spacer is load-bearing, not decoration.
    const { container } = renderShell();
    const strip = container.querySelector(".wco")!;
    const spacers = Array.from(strip.children).filter(
      (el) =>
        el.querySelectorAll(INTERACTIVE_SELECTOR).length === 0 &&
        el.classList.contains("flex-1"),
    );
    expect(spacers.length).toBeGreaterThan(0);
  });

  /**
   * BOTH REPRESENTATIONS OF THE ENVIRONMENT CONTROL, because there are two and
   * only one of them is ever on screen.
   *
   * `EnvToggle` is the `sm`-and-up segmented pair (`role="group"`); `EnvChip` is
   * the single button a phone gets, which opens a sheet and confirms. jsdom
   * loads no stylesheet, so `sm:hidden` hides nothing here and both are in the
   * tree at once — which is what lets one test pin both, and is worth knowing
   * before reading a count in this file as a count of what a user sees.
   *
   * STILL SCOPED TO THE STRIP, for a different reason than it used to be. The
   * old note said BottomNav carried its own Search for `< md`, so a
   * document-wide query would match either copy; that cell is gone (the strip's
   * button is unconditional now, which is what closed the 768–1023px hole where
   * neither rendered). The scope earns its keep because the chip's sheet and its
   * confirmation are portalled to `<body>` and name the environment too — a
   * document-wide query would start matching those the moment one is open.
   */
  it("keeps the utility controls reachable after the move out of the nav row", () => {
    const { container } = renderShell();
    const strip = within(container.querySelector<HTMLElement>(".wco")!);
    expect(
      strip.getByRole("group", { name: "Data environment" }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole("button", { name: /data environment/i }),
    ).toBeInTheDocument();
    expect(strip.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  /**
   * THE UTILITY CLUSTER IS NOT WAITING ON ANYTHING, which is why it has no
   * skeleton.
   *
   * The optimistic-cache work gave the ribbon and the rail's pinned middle
   * shimmering placeholders, because both are drawn from `GET
   * /permissions/mine` and both were zero-height until it answered. The obvious
   * next step is to give this strip placeholders too — and it would be a
   * downgrade: none of it is permission-derived, so it paints as ITSELF on the
   * first frame, and swapping real controls for grey boxes would remove
   * function to add the appearance of loading.
   *
   * Asserted synchronously, with no `await` and no settled fetch, because "on
   * the first frame" is the entire claim. If a later change made any of these
   * conditional on the access read, this is where it would show up.
   */
  it("paints the search field and the utility controls before any permissions read settles", () => {
    const { container } = renderShell();
    const strip = within(container.querySelector<HTMLElement>(".wco")!);
    expect(strip.getByRole("button", { name: /search/i })).toBeInTheDocument();
    expect(
      strip.getByRole("group", { name: "Data environment" }),
    ).toBeInTheDocument();
    // The phone's env chip is on the same footing: it reads `env` from
    // tokenStore, not `access`, so it must paint on the first frame too.
    expect(
      strip.getByRole("button", { name: /data environment/i }),
    ).toBeInTheDocument();
    expect(
      strip.getByRole("button", { name: /notification/i }),
    ).toBeInTheDocument();
    // Nothing in the strip is a placeholder.
    expect(container.querySelector(".wco .animate-pulse")).toBeNull();
  });

  /**
   * AND NO QUICK-ACTIONS TRIGGER, AT ANY WIDTH.
   *
   * It was a burst icon in a strip where every other control says what it is,
   * and it put Messages in the title bar while the icon rail already carried
   * Messages — one destination, two chrome homes, and an unread count that had
   * to be duplicated between them to stay honest. The rail's own Messages cell
   * carries the count now (`icon-rail.tsx`), and the touch cluster is the
   * surface below `md`.
   *
   * Asserted as an ABSENCE because that is the whole requirement: a control
   * removed on purpose comes back the next time someone needs somewhere to put
   * a button, and a strip is where buttons go when nobody has said no.
   */
  it("has no quick-actions trigger in the strip", () => {
    const { container } = renderShell();
    const strip = within(container.querySelector<HTMLElement>(".wco")!);
    expect(
      strip.queryByRole("button", { name: /quick actions/i }),
    ).toBeNull();
  });

  /**
   * THE BELL IS IN THE STRIP ON A PHONE TOO.
   *
   * It was `hidden … sm:grid`, and below 640px nothing replaced it: the bottom
   * nav carries the navigation families and nothing else, and the touch cluster
   * carries Praxis AI / Messages / Help. So a phone had the unread count on the
   * tab title and on the installed app's icon — two places it cannot be ACTED
   * on — and no route to the notifications short of typing /notifications.
   *
   * jsdom has no viewport, so the class is what is asserted: the point is that
   * no width-gated class hides it, not that a particular pixel width renders.
   */
  it("keeps the notification bell at every width, phone included", () => {
    const { container } = renderShell();
    const strip = within(container.querySelector<HTMLElement>(".wco")!);
    const bell = strip.getByRole("button", { name: /notification/i });
    expect(bell.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(bell.className).toContain("grid");
  });

  /**
   * THE FLOATING CLUSTER APPEARS ON SMART COMMS TOO.
   *
   * It was `!chatWorkstation &&`, because the cluster lands on the composer's
   * Send button — the mic, when nothing is typed, which is the control that
   * sends a voice note. The stand-in was the title bar's quick-actions menu,
   * and that menu is gone at every width: keeping the exception would leave a
   * phone in Smart Comms with no quick actions and no clock-in at all.
   *
   * The overlap is settled where it is caused — the composer publishes
   * `--fab-floor` and the cluster anchors above it (`lib/fab-floor.ts`) — so
   * what belongs here is only that the shell no longer makes an exception of
   * the route. Portalled to <body>, hence `screen` and not `container`.
   */
  it("renders the floating cluster on the chat workstation, not only off it", () => {
    renderShellAt("/comms");
    expect(
      screen.getByRole("button", { name: /Quick actions/ }),
    ).toBeInTheDocument();
  });

  it("renders it on an ordinary screen too", () => {
    renderShell();
    expect(
      screen.getByRole("button", { name: /Quick actions/ }),
    ).toBeInTheDocument();
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
   * AND THE NAME STANDS DOWN ON A PHONE.
   *
   * It is here because this strip REPLACES the OS title bar in an installed
   * desktop window. There is no WCO on a phone, so below `sm` it is an ordinary
   * app bar and the name is the one element in it carrying no function — the
   * icon beside it says the same thing.
   *
   * That 60px is what pays for the notification bell rendering at every width.
   * The class is asserted rather than the rendered width because jsdom lays
   * nothing out; the CONSEQUENCE — that the drag handle survives at 320px — is
   * measured in a real browser by `e2e/layout.spec.ts`, which is where the
   * arithmetic actually happens.
   */
  it("hides the app name below sm, keeping the icon", () => {
    const { container } = renderShell();
    const strip = container.querySelector<HTMLElement>(".wco")!;
    const name = within(strip).getByText("Acme Freight");
    expect(name.className).toContain("hidden");
    expect(name.className).toContain("sm:inline");
    // The icon is not gated — the identity survives at every width.
    expect(strip.querySelector(".wco-mark > :first-child")).not.toBeNull();
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
    const img = within(strip).getAllByRole("presentation", {
      hidden: true,
    })[0] as HTMLImageElement;
    expect(img.src).toContain("wordmark.png");

    const box = img.parentElement!;
    expect(box.style.width).toBe(box.style.height);
    expect(box).toHaveClass("overflow-hidden");
    expect(img.style.objectFit).toBe("contain");
  });

  /**
   * THE MARK IS CENTRED ON THE ICON RAIL, and the sum has to stay derivable.
   *
   * `.wco-mark` offsets the mark by `(--rail-w - --wco-mark-size) / 2` so its
   * axis lands on the rail's Home button directly below it. jsdom loads no
   * stylesheet, so the offset itself cannot be measured here — what CAN be
   * pinned is the input the rule depends on: the component must publish the
   * size it actually renders at. Hard-code a different number in the CSS, or
   * drop the variable, and the mark silently drifts off the rail with every
   * other test still green.
   */
  it("publishes its icon size to CSS, so the rail alignment stays derived", () => {
    const { container } = renderShell();
    const mark = container.querySelector<HTMLElement>(".wco .wco-mark")!;
    expect(mark).not.toBeNull();

    const declared = mark.style.getPropertyValue("--wco-mark-size");
    expect(declared).toBe("20px");

    // …and it is the size the icon is genuinely drawn at, not a stale copy.
    const img = within(mark).getAllByRole("presentation", {
      hidden: true,
    })[0] as HTMLImageElement;
    expect(img.parentElement!.style.width).toBe(declared);
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

/**
 * THE PHONE'S HALF OF THE STRIP, AND THE ENVIRONMENT SWITCH ON EVERY WIDTH.
 *
 * Search was `lg:flex` in the strip and `md:hidden` in the bottom bar, so
 * 768–1023px had neither. ⌘K still worked, which is exactly why nobody found
 * it — a keyboard hides the hole from the people who could fix it.
 *
 * The environment switch used to be TWO behaviours: the phone's chip asked
 * before switching, the desktop's segmented control switched on one
 * unconfirmed click, and neither reloaded — so state from the outgoing
 * environment leaked into the new one until someone pressed Ctrl+F5. Now every
 * control (chip, segmented toggle, sandbox banner) opens the SAME dialog, which
 * says unsaved work will not survive, and a confirmed switch persists the
 * choice and reloads the page.
 *
 * The assertions below are about NAMES and ORDER OF EVENTS rather than
 * appearance, for the reason this file's header gives: jsdom loads no
 * stylesheet, so a breakpoint is not observable here. What is observable is
 * whether the control is in the tree, what it is called, what it says before
 * it acts, and whether `location.reload` was called — and each of those is
 * where these bugs actually lived.
 */
describe("search and the environment control", () => {
  let reload: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    // `tokenStore` reads the environment out of localStorage when the shell
    // mounts, and these tests write it. Without this, whichever test switched
    // last decides which environment the next one starts in — and half of them
    // are about which direction the switch goes.
    localStorage.clear();
    // jsdom's `location.reload` is "not implemented" and throws. The switch
    // ends in a reload, so it is replaced with a spy — the same shape
    // nav-refresh.test.tsx uses — and put back after each test.
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, reload },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
      writable: true,
    });
  });

  const stripIn = (container: HTMLElement) =>
    within(container.querySelector<HTMLElement>(".wco")!);

  const chipIn = (container: HTMLElement) =>
    stripIn(container).getByRole("button", { name: /data environment/i });

  /** The desktop control: a labelled group of two pressed/unpressed cells. */
  const toggleIn = (container: HTMLElement) =>
    within(stripIn(container).getByRole("group", { name: "Data environment" }));

  it("keeps search named at every width and reveals its label only from lg", () => {
    const { container } = renderShell();
    const search = stripIn(container).getByRole("button", { name: "Search" });

    // The name is on `aria-label`, so it survives the label being hidden — which
    // is the only reason an icon-only button is addressable at all.
    expect(search).toHaveAccessibleName("Search");

    // "Not visible below lg" cannot be measured in jsdom (no stylesheet), so
    // what is pinned is the gate that produces it: both the label and the badge
    // are `hidden` until `lg:inline`. Drop the `hidden` and a 360px strip gets a
    // ~90px pill it has no room for; drop the `lg:inline` and the desktop
    // control silently becomes an icon.
    expect(within(search).getByText("Search…")).toHaveClass(
      "hidden",
      "lg:inline",
    );
    expect(within(search).getByText("⌘K")).toHaveClass("hidden", "lg:inline");
  });

  it("states the current environment on the chip, and what pressing it does", () => {
    const { container } = renderShell();
    const chip = chipIn(container);

    expect(chip).toHaveTextContent("LIVE");
    // Not `aria-label="LIVE"`. A lone value tells a screen-reader user what the
    // button reads and nothing about what activating it will do, which on a
    // control that changes which database you are writing to is the half that
    // matters.
    expect(chip).toHaveAccessibleName(
      "Data environment: LIVE. Change environment.",
    );
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("opens the switch dialog from the chip: both environments, the warning, and the two outcomes", async () => {
    const { container } = renderShell();
    await userEvent.click(chipIn(container));

    const dialog = await screen.findByRole("dialog", { name: "Switch to TEST mode?" });
    // Where you are and where you are going, both named — the sheet this
    // replaced carried the same two facts one tap later.
    expect(within(dialog).getByText("You are in")).toBeInTheDocument();
    expect(within(dialog).getByText("You'll be in")).toBeInTheDocument();
    expect(within(dialog).getByText("Real data. Changes are permanent.")).toBeInTheDocument();
    expect(within(dialog).getByText("Sandbox data. Changes don't affect live.")).toBeInTheDocument();
    // THE warning. A switch reloads the page, so this is the sentence the
    // dialog exists to put in front of the answer.
    expect(within(dialog).getByRole("note")).toHaveTextContent("Unsaved changes will be lost");
    expect(within(dialog).getByText(/Praxis reloads to open TEST/)).toBeInTheDocument();
    // Outcomes, not Yes/No.
    expect(within(dialog).getByRole("button", { name: "Stay in LIVE" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Switch to TEST" })).toBeInTheDocument();
  });

  it("asks before leaving LIVE, and a cancelled ask changes nothing", async () => {
    const { container } = renderShell();
    await userEvent.click(chipIn(container));

    const confirm = await screen.findByRole("dialog", { name: "Switch to TEST mode?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Stay in LIVE" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // `switchEnv` persists through `tokenStore` under `praxis.env` before
    // anything else happens, so an absent key is the strongest available
    // statement that it never ran — stronger than the absent overlay beside it.
    expect(localStorage.getItem("praxis.env")).toBeNull();
    expect(screen.queryByText("Loading fresh data…")).toBeNull();
    // Give the reload delay a chance to elapse before declaring it never came.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByText(/TEST MODE/)).toBeNull();
  });

  it("performs the switch once confirmed: persists TEST, covers the screen, then reloads", async () => {
    const { container } = renderShell();
    await userEvent.click(chipIn(container));

    const confirm = await screen.findByRole("dialog", { name: "Switch to TEST mode?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Switch to TEST" }));

    // The order of events IS the fix. The environment is persisted and the
    // overlay is up BEFORE the reload — so the new document boots into TEST
    // and nothing from the LIVE screen is readable in the meantime…
    expect(localStorage.getItem("praxis.env")).toBe("sandbox");
    const overlay = screen.getByRole("status", { name: "Environment switch" });
    expect(overlay).toHaveTextContent("Switching to TEST");
    expect(overlay).toHaveTextContent("Loading fresh data…");
    expect(reload).not.toHaveBeenCalled();
    // …and the shell does NOT flip in place: the sandbox banner belongs to the
    // next document, not to a soft switch of this one.
    expect(screen.queryByText(/TEST MODE/)).toBeNull();

    // …then the page reloads, which is what Ctrl+F5 did by hand.
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("asks in the other direction too — TEST back to LIVE is not a free action", async () => {
    localStorage.setItem("praxis.env", "sandbox");
    const { container } = renderShell();
    expect(chipIn(container)).toHaveTextContent("TEST");

    await userEvent.click(chipIn(container));
    const confirm = await screen.findByRole("dialog", { name: "Switch to LIVE mode?" });
    expect(within(confirm).getByRole("note")).toHaveTextContent("Unsaved changes will be lost");
    await userEvent.click(within(confirm).getByRole("button", { name: "Switch to LIVE" }));

    expect(localStorage.getItem("praxis.env")).toBe("live");
    expect(screen.getByRole("status", { name: "Environment switch" })).toHaveTextContent("Switching to LIVE");
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("gives the desktop toggle the SAME dialog — no single-click switch under a pointer", async () => {
    const { container } = renderShell();
    const toggle = toggleIn(container);
    const live = toggle.getByRole("button", { name: "LIVE" });
    const test = toggle.getByRole("button", { name: "TEST" });
    expect(live).toHaveAttribute("aria-pressed", "true");
    expect(test).toHaveAttribute("aria-pressed", "false");

    // The cell you are already in is not a switch, so it does not ask.
    await userEvent.click(live);
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(test);
    const confirm = await screen.findByRole("dialog", { name: "Switch to TEST mode?" });
    expect(within(confirm).getByRole("note")).toHaveTextContent("Unsaved changes will be lost");
    // Nothing has happened yet — the click alone used to be the switch.
    expect(localStorage.getItem("praxis.env")).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(within(confirm).getByRole("button", { name: "Switch to TEST" }));
    expect(localStorage.getItem("praxis.env")).toBe("sandbox");
    expect(screen.getByRole("status", { name: "Environment switch" })).toHaveTextContent("Switching to TEST");
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("routes the sandbox banner's way out through the same dialog", async () => {
    // The banner used to call `switchEnv("live")` straight from its onClick, so
    // a phone had two routes between environments and only one of them asked.
    localStorage.setItem("praxis.env", "sandbox");
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Switch to live" }));
    const confirm = await screen.findByRole("dialog", { name: "Switch to LIVE mode?" });
    expect(within(confirm).getByRole("button", { name: "Switch to LIVE" })).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "Stay in TEST" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem("praxis.env")).toBe("sandbox");
    expect(screen.getByText(/TEST MODE/)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("offers the reload by hand if the page is still here after the switch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = renderShell();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(chipIn(container));
      const confirm = await screen.findByRole("dialog", { name: "Switch to TEST mode?" });
      await user.click(within(confirm).getByRole("button", { name: "Switch to TEST" }));

      // The reload fires, but a `beforeunload` guard on the screen can make the
      // browser ask its own question, and "stay" leaves the overlay up over a
      // page going nowhere. After a few seconds the overlay offers the reload
      // again rather than sitting there forever.
      await vi.advanceTimersByTimeAsync(600);
      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "Still here? Reload now" })).toBeNull();

      await vi.advanceTimersByTimeAsync(5000);
      await user.click(screen.getByRole("button", { name: "Still here? Reload now" }));
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
