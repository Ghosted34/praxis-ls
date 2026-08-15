/**
 * The two-layer appearance model: the tenant's branding is the base, the
 * signed-in user's typography sits on top.
 *
 * This is the behaviour the feature is actually judged on — "each user under
 * each tenant can set their own fonts, and everyone else keeps the tenant's".
 * It is also the easiest thing to break silently, because both layers write the
 * same three CSS variables and whichever paints last wins. These cases pin the
 * precedence, the fallback, and the two orderings that a real session produces:
 * branding-then-user (a fresh load) and user-then-branding (an admin saving the
 * tenant palette while their own override is in force).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrandingProvider, useBranding } from "./branding-context";
import { UserAppearanceSync } from "./user-appearance-sync";
import { resetBrand } from "@/lib/theme";
import type { Branding } from "@/lib/branding";
import type { UserAppearance } from "@/lib/preferences";

vi.mock("@/lib/branding", async (orig) => ({
  ...(await orig<typeof import("@/lib/branding")>()),
  fetchBranding: vi.fn(),
}));
vi.mock("@/lib/preferences", async (orig) => ({
  ...(await orig<typeof import("@/lib/preferences")>()),
  fetchUserAppearance: vi.fn(),
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: vi.fn() }));
// The real loaders import @fontsource CSS, which jsdom cannot parse and which
// would make these cases about Vite rather than about precedence.
vi.mock("@/lib/fonts", async (orig) => ({
  ...(await orig<typeof import("@/lib/fonts")>()),
  loadFonts: vi.fn().mockResolvedValue(undefined),
}));

const { fetchBranding } = await import("@/lib/branding");
const { fetchUserAppearance } = await import("@/lib/preferences");
const { useAuth } = await import("@/app/auth/auth-context");
const { loadFonts } = await import("@/lib/fonts");

const TENANT: Branding = {
  name: "Smart Logistics",
  primary: "#F5821F",
  primaryForeground: "#FFFFFF",
  logoUrl: null,
  fontDisplay: '"Montserrat Variable", "Montserrat", sans-serif',
  fontBody: '"Montserrat Variable", "Montserrat", sans-serif',
  fontMono: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
};

const NO_OVERRIDE: UserAppearance = {
  fontDisplay: null,
  fontBody: null,
  fontMono: null,
};

const cssVar = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

function signedIn(userId = "user-1") {
  vi.mocked(useAuth).mockReturnValue({
    status: "authed",
    user: { user_id: userId },
  } as never);
}

/** Exposes the context so a case can drive a live save. */
function Harness() {
  const { setUserAppearance, setBranding } = useBranding();
  return (
    <>
      <button
        onClick={() =>
          setUserAppearance({
            ...NO_OVERRIDE,
            fontBody: '"Lora Variable", Lora, serif',
          })
        }
      >
        override body
      </button>
      <button
        onClick={() =>
          setBranding({ ...TENANT, fontBody: '"Lato", sans-serif' })
        }
      >
        rebrand
      </button>
    </>
  );
}

function mount() {
  return render(
    <BrandingProvider>
      <UserAppearanceSync />
      <Harness />
    </BrandingProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchBranding).mockResolvedValue(TENANT);
  vi.mocked(fetchUserAppearance).mockResolvedValue(NO_OVERRIDE);
  signedIn();
});
afterEach(() => {
  resetBrand();
  vi.clearAllMocks();
});

describe("tenant + user appearance", () => {
  it("paints the tenant's fonts for a user with no override", async () => {
    mount();
    await waitFor(() => expect(cssVar("--font-body")).toBe(TENANT.fontBody));
    expect(cssVar("--font-display")).toBe(TENANT.fontDisplay);
  });

  it("lets a user's font win over the tenant's", async () => {
    vi.mocked(fetchUserAppearance).mockResolvedValue({
      ...NO_OVERRIDE,
      fontBody: '"Lora Variable", Lora, serif',
    });
    mount();
    await waitFor(() =>
      expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif'),
    );
  });

  /**
   * A user overrides ONE slot. The other two must keep tracking the tenant —
   * not fall back to the app default, and not freeze at whatever the tenant
   * happened to be set to when the override was saved.
   */
  it("inherits every slot the user did not override", async () => {
    vi.mocked(fetchUserAppearance).mockResolvedValue({
      ...NO_OVERRIDE,
      fontBody: '"Lora Variable", Lora, serif',
    });
    mount();
    await waitFor(() =>
      expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif'),
    );
    expect(cssVar("--font-display")).toBe(TENANT.fontDisplay);
    expect(cssVar("--font-mono")).toBe(TENANT.fontMono);
  });

  it("never lets a user restyle the brand colour", async () => {
    vi.mocked(fetchUserAppearance).mockResolvedValue({
      ...NO_OVERRIDE,
      fontBody: "Lora",
    });
    mount();
    await waitFor(() => expect(cssVar("--font-body")).toBe("Lora"));
    // The tenant's primary survives the personal repaint untouched.
    expect(cssVar("--primary")).toBe(TENANT.primary);
  });

  it("applies a save immediately, without a reload", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(cssVar("--font-body")).toBe(TENANT.fontBody));

    await user.click(screen.getByRole("button", { name: "override body" }));
    expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif');
  });

  /**
   * THE STALE-CLOSURE CASE. An admin with a personal override saves the tenant
   * palette. If setBranding repainted from a captured copy of the overrides
   * instead of the live one, their own font would silently revert until the
   * next reload — and only for them, which is the hardest kind of bug to
   * believe a report of.
   */
  it("keeps the user's override when the tenant branding is re-saved", async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(cssVar("--font-body")).toBe(TENANT.fontBody));

    await user.click(screen.getByRole("button", { name: "override body" }));
    await user.click(screen.getByRole("button", { name: "rebrand" }));

    // The tenant moved to Lato; this user still reads Lora.
    expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif');
    // …and a slot they did NOT override follows the tenant's new value.
    expect(cssVar("--font-display")).toBe(TENANT.fontDisplay);
  });

  it("drops the personal layer on sign-out, so the next user starts clean", async () => {
    vi.mocked(fetchUserAppearance).mockResolvedValue({
      ...NO_OVERRIDE,
      fontBody: '"Lora Variable", Lora, serif',
    });
    const { rerender } = mount();
    await waitFor(() =>
      expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif'),
    );

    vi.mocked(useAuth).mockReturnValue({ status: "anon", user: null } as never);
    rerender(
      <BrandingProvider>
        <UserAppearanceSync />
        <Harness />
      </BrandingProvider>,
    );
    await waitFor(() => expect(cssVar("--font-body")).toBe(TENANT.fontBody));
  });

  /**
   * A personal preference is not worth breaking the app over. If the endpoint
   * is down or the device is offline, the tenant's type is already painted and
   * stays correct.
   */
  it("falls back to the tenant's fonts when the preference fetch fails", async () => {
    vi.mocked(fetchUserAppearance).mockRejectedValue(new Error("offline"));
    mount();
    await waitFor(() => expect(cssVar("--font-body")).toBe(TENANT.fontBody));
  });

  /**
   * The lazy-loading decision, asserted where it is actually made: a session
   * pulls the families in force, not the fifteen in the library.
   */
  it("loads only the fonts actually in force", async () => {
    vi.mocked(fetchUserAppearance).mockResolvedValue({
      ...NO_OVERRIDE,
      fontBody: '"Lora Variable", Lora, serif',
    });
    mount();
    await waitFor(() =>
      expect(cssVar("--font-body")).toBe('"Lora Variable", Lora, serif'),
    );

    expect(loadFonts).toHaveBeenLastCalledWith([
      TENANT.fontDisplay,
      '"Lora Variable", Lora, serif',
      TENANT.fontMono,
    ]);
  });
});
