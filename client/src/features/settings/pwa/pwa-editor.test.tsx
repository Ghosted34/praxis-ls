/**
 * The App & PWA editor — the parts of it that are claims rather than markup.
 *
 * WHAT IS ACTUALLY AT RISK HERE. Not "does the form render" — the axe/screen
 * gates cover that shape of defect elsewhere. What this screen can get wrong,
 * silently and only on a real phone, is:
 *
 *   1. **Showing a preview that isn't what ships.** The whole screen is an
 *      argument that "this is what your icon will look like". The preview draws
 *      from `iconLayout()`; the server composites from the same function
 *      (proven against real pixels in tests/unit/pwa-design.test.js). What is
 *      left to prove on this side is that the preview element is positioned
 *      from that function and not from a hand-written approximation.
 *   2. **Turning "inherit" into a saved value.** Every field is nullable and
 *      null means "follow the brand". A form that seeds its inputs with the
 *      resolved defaults and then posts all of them would freeze today's brand
 *      colour into the PWA config, and nobody would notice until the brand
 *      changed and the app icon didn't.
 *   3. **A safe-zone warning that is decorative.** It has to fire on the case
 *      it exists for — a mark zoomed past the crop — and stay quiet otherwise,
 *      or it trains people to ignore it.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";

import { effectivePwa, EMPTY_PWA_CONFIG, iconLayout, type PwaConfig } from "@/lib/pwa-config";
import { escapesSafeZone, iconWarnings, splashWarnings, manifestWarnings } from "./validation";
import { AppIcon } from "./previews";

const BRAND = { name: "Acme Freight", primary: "#1188ff", logoUrl: "/media/tenant_acme/branding/logo.png", theme: "dark" as const };

/* ── the preview draws from the shared resolver ───────────────────────────── */

describe("AppIcon — positioned by the same function the server composites with", () => {
  it("places the artwork at iconLayout's fractions, not at an approximation", () => {
    const cfg = effectivePwa({ iconPadding: 20, iconZoom: 100 }, BRAND);
    const { container } = render(<AppIcon cfg={cfg} size={100} />);
    const img = container.querySelector("img")!;
    const { size, left, top } = iconLayout(cfg, false);

    expect(img.style.left).toBe(`${left * 100}%`);
    expect(img.style.top).toBe(`${top * 100}%`);
    expect(img.style.width).toBe(`${size * 100}%`);
    // `contain` into a square box is the CSS equivalent of sharp's
    // `fit: "contain"`. If this changes, the preview stops matching the PNG.
    expect(img.style.objectFit).toBe("contain");
  });

  it("uses the safe-zone padding for the maskable variant", () => {
    const cfg = effectivePwa(null, BRAND);
    const { container } = render(<AppIcon cfg={cfg} maskable size={100} />);
    const img = container.querySelector("img")!;
    expect(img.style.left).toBe(`${iconLayout(cfg, true).left * 100}%`);
    expect(img.style.left).not.toBe(`${iconLayout(cfg, false).left * 100}%`);
  });

  it("renders the monogram fallback when there is no artwork, like the server does", () => {
    const cfg = effectivePwa(null, { name: "Zenith Cargo", primary: "#1188ff" });
    const { container } = render(<AppIcon cfg={cfg} size={64} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("Z");
  });

  it("never rounds the maskable variant — the launcher supplies the shape", () => {
    const cfg = effectivePwa({ iconRadius: 40 }, BRAND);
    const { container } = render(<AppIcon cfg={cfg} maskable size={64} />);
    expect((container.firstChild as HTMLElement).style.borderRadius).toBe("0%");
  });
});

/* ── the safe-zone check ──────────────────────────────────────────────────── */

describe("escapesSafeZone", () => {
  it("is quiet at the default framing, which fits inside the crop", () => {
    expect(escapesSafeZone(effectivePwa(null, BRAND))).toBe(false);
  });

  it("fires when zoom pushes the artwork past the circle", () => {
    expect(escapesSafeZone(effectivePwa({ iconZoom: 180 }, BRAND))).toBe(true);
  });

  it("fires when a nudge walks it off centre", () => {
    expect(escapesSafeZone(effectivePwa({ iconOffsetX: 25 }, BRAND))).toBe(true);
  });

  it("is quiet again once the padding is raised to compensate", () => {
    expect(escapesSafeZone(effectivePwa({ iconZoom: 130, maskablePadding: 35 }, BRAND))).toBe(false);
  });
});

describe("warnings — each one has to be actionable", () => {
  it("reports the actual pixel dimensions of a non-square source", () => {
    const w = iconWarnings(effectivePwa(null, BRAND), { width: 400, height: 120 });
    const notSquare = w.find((x) => x.id === "not-square")!;
    expect(notSquare.tone).toBe("warn");
    expect(notSquare.detail).toContain("400×120");
  });

  it("flags a source too small for the install prompt", () => {
    const w = iconWarnings(effectivePwa(null, BRAND), { width: 256, height: 256 });
    expect(w.map((x) => x.id)).toContain("too-small");
  });

  it("says nothing alarming when there is simply no icon yet", () => {
    const w = iconWarnings(effectivePwa(null, { name: "Acme" }), null);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ id: "no-icon", tone: "info" });
  });

  it("warns when the brand colour disappears into the splash background", () => {
    const w = splashWarnings(effectivePwa({ splashBackground: "#1188ff" }, BRAND));
    expect(w.map((x) => x.id)).toContain("splash-accent");
  });

  it("warns that browser display mode is not installable", () => {
    const w = manifestWarnings(effectivePwa({ display: "browser" }, BRAND));
    expect(w.map((x) => x.id)).toContain("display-browser");
  });

  it("stays quiet on a well-formed configuration", () => {
    const cfg = effectivePwa({ splashBackground: "#0b0f10", splashDuration: 600 }, BRAND);
    expect(splashWarnings(cfg)).toHaveLength(0);
    expect(manifestWarnings(cfg)).toHaveLength(0);
  });
});

/* ── the page itself ──────────────────────────────────────────────────────── */

const saveSpy = vi.fn(async (patch: Partial<PwaConfig>) => ({ ...EMPTY_PWA_CONFIG, ...patch }));

vi.mock("@/lib/pwa-config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pwa-config")>("@/lib/pwa-config");
  return {
    ...actual,
    fetchPwaConfig: vi.fn(async () => actual.EMPTY_PWA_CONFIG),
    savePwaConfig: (patch: Partial<PwaConfig>) => saveSpy(patch),
    uploadAppIcon: vi.fn(async () => ({ iconUrl: "/media/tenant_acme/branding/appicon_x.png" })),
  };
});

vi.mock("@/app/branding/branding-context", async () => {
  const { effectivePwa: resolve, EMPTY_PWA_CONFIG: empty } =
    await vi.importActual<typeof import("@/lib/pwa-config")>("@/lib/pwa-config");
  return {
    useBranding: () => ({
      branding: BRAND,
      setBranding: vi.fn(),
      ready: true,
      pwa: resolve(empty, BRAND),
      pwaConfig: empty,
      setPwaConfig: vi.fn(),
    }),
    BrandingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import { PwaPage } from "../pwa-page";

const renderPage = () =>
  render(
    <MemoryRouter>
      <PwaPage />
    </MemoryRouter>,
  );

describe("PwaPage", () => {
  it("shows what each field inherits as a placeholder, not as a value", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Identity" }));

    const appName = await screen.findByLabelText("App name");
    // Empty, but the brand name is visible — "unset" reads as "same as the
    // brand", which is what makes this screen safe to open and close.
    expect(appName).toHaveValue("");
    expect(appName).toHaveAttribute("placeholder", "Acme Freight");
  });

  it("does not save inherited values just because they were displayed", async () => {
    const user = userEvent.setup();
    saveSpy.mockClear();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Identity" }));
    await user.type(await screen.findByLabelText("App name"), "Acme Go");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const patch = saveSpy.mock.calls[0][0];
    expect(patch.appName).toBe("Acme Go");
    // The brand colour was shown on the colour input and never touched — it
    // must not have been frozen into the PWA config by being rendered.
    expect(patch.themeColor).toBeNull();
    expect(patch.iconUrl).toBeNull();
    expect(patch.splashPreset).toBeNull();
  });

  it("clearing a field posts null, which is how a tenant goes back to inheriting", async () => {
    const user = userEvent.setup();
    saveSpy.mockClear();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Identity" }));
    const appName = await screen.findByLabelText("App name");
    await user.type(appName, "Temp");
    await user.clear(appName);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(saveSpy.mock.calls[0][0].appName).toBeNull();
  });

  it("surfaces the safe-zone warning next to the preview that shows it", async () => {
    renderPage();
    // Default framing is clean, so the warning must not be shown by default.
    expect(screen.queryByText(/outside the maskable safe zone/i)).not.toBeInTheDocument();

    const zoom = screen.getByLabelText("Zoom");
    // fireEvent-style set: a range input is dragged, not typed into.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(zoom, "190");
    zoom.dispatchEvent(new Event("input", { bubbles: true }));

    expect(await screen.findByText(/outside the maskable safe zone/i)).toBeInTheDocument();
  });

  it("is free of accessibility violations on every tab", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    for (const tab of ["Icon", "Identity", "Splash", "Install", "Offline"]) {
      await user.click(screen.getByRole("tab", { name: tab }));
      expect(await axe(container)).toHaveNoViolations();
    }
  }, 30_000);
});
