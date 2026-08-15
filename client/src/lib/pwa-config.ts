/**
 * Installed-app (PWA) design — the client half of `GET/PUT /branding/pwa`.
 *
 * The TYPES and the fallback resolution both come from `@shared`
 * (packages/shared/pwa-design.js), which the Express API uses to render the
 * actual home-screen PNG. That is deliberate: this module feeds the editor's
 * previews, and a preview computed from a second copy of the rules would be a
 * preview of something else.
 */
import {
  pwaDesign,
  type PwaConfig,
  type EffectivePwa,
  type PwaBrandSource,
} from "@shared";
import { tenant } from "./api-client";
import type { Branding } from "./branding";

export type { PwaConfig, EffectivePwa };
export const {
  effectivePwa,
  iconLayout,
  resolveTitlebar,
  PWA_DEFAULTS,
  PWA_RANGES,
  SPLASH_FALLBACK_BG,
} = pwaDesign;

/** Everything unset — what a tenant that has never opened the editor has. */
export const EMPTY_PWA_CONFIG: PwaConfig = {
  appName: null,
  shortName: null,
  description: null,
  display: null,
  orientation: null,
  themeColor: null,
  backgroundColor: null,
  iconUrl: null,
  iconBackground: null,
  iconPadding: null,
  iconZoom: null,
  iconOffsetX: null,
  iconOffsetY: null,
  iconRadius: null,
  maskableBackground: null,
  maskablePadding: null,
  splashEnabled: null,
  splashPreset: null,
  splashDuration: null,
  splashBackground: null,
  splashTagline: null,
  splashShowProgress: null,
  installEnabled: null,
  installTitle: null,
  installBody: null,
  installIosBody: null,
  installButton: null,
  offlineText: null,
  offlineReadyText: null,
  updateTitle: null,
  updateBody: null,
  updateButton: null,
  titlebarMode: null,
  titlebarLight: null,
  titlebarDark: null,
  titlebarImageUrl: null,
  titlebarImageOpacity: null,
  titlebarBlur: null,
};

/** Narrow the full Branding shape to the fields the PWA resolution inherits. */
export function brandSource(b: Branding): PwaBrandSource {
  return {
    name: b.name,
    primary: b.primary,
    logoUrl: b.logoUrl,
    theme: b.theme,
  };
}

/**
 * Escape a URL for safe use inside a CSS `url("…")`. The value is a /media path
 * this app minted, but it reaches here through a text input that also accepts a
 * pasted URL — and a `")` in a custom property would break out of the
 * declaration and let the rest of the string be read as CSS.
 */
function cssUrl(url: string): string {
  return url.replace(/["\\]/g, "\\$&").replace(/\n/g, "");
}

/**
 * THE WINDOW FRAME IS THE MANIFEST'S, UNTIL SOMETHING CHANGES AFTER LOAD.
 *
 * An installed window has two painters. The page draws the title-bar strip
 * (`--titlebar-bg`); the browser draws what the page may not — the rounded top
 * corners and the band behind the minimise/maximise/close buttons — and it
 * takes that colour from the manifest's `theme_color`, letting the page's
 * `<meta name="theme-color">` override it.
 *
 * The override only lands on a change the browser observes AFTER the document
 * has loaded. Everything this app writes before then — the pre-paint script in
 * index.html, and this module's first call while the bundle is still booting —
 * is folded into the initial load and loses to the manifest. So on every
 * refresh the frame came back as whatever `theme_color` says, which the server
 * resolves against the TENANT's default theme (`brand_theme`), not the user's:
 * a dark-mode user in a light-default workspace got a white frame around a dark
 * app, and the only way out was to toggle light → dark, because THAT is a
 * post-load change. This does the same thing without the toggle.
 *
 * Detaching and re-inserting the element is what makes it a real transition
 * rather than a repeat of a value the browser has already dismissed: the
 * removal reports "no theme colour" (the frame falls back to the manifest) and
 * the insertion reports ours. Both happen in one synchronous task, so no frame
 * is ever painted with the tag missing.
 *
 * ONCE PER TAG, which is once per document: the tag outlives every branding
 * change, and re-running this on each one would detach and reattach the element
 * on every keystroke in the colour picker. Tracked against the element rather
 * than in a module-level flag so the guard is tied to the thing it is actually
 * about — a replaced tag is a new document's tag, and needs the poke again.
 */
const poked = new WeakSet<HTMLMetaElement>();

function pokeWindowFrame(meta: HTMLMetaElement) {
  if (poked.has(meta)) return;
  poked.add(meta);
  const poke = () => {
    const parent = meta.parentNode;
    if (!parent) return;
    const next = meta.nextSibling;
    parent.removeChild(meta);
    parent.insertBefore(meta, next);
  };
  if (document.readyState === "complete") poke();
  else window.addEventListener("load", poke, { once: true });
}

/** Write the title-bar colour the browser reads, creating the tag if the
 *  document somehow has none, and make the first write of a document stick. */
function setThemeColor(value: string) {
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = value;
  pokeWindowFrame(meta);
}

/**
 * Point the manifest at the theme the user is actually in.
 *
 * `theme_color` is read before a single line of ours runs, so the server has to
 * resolve it without a live theme to ask — and the only theme it can see is the
 * tenant-wide `brand_theme`, while light/dark is a PER-USER choice living in
 * localStorage. The hint closes that gap: the next cold start fetches a
 * manifest whose frame colour already matches, so the first painted frame is
 * right rather than merely corrected. index.html sets this before first paint;
 * this keeps it in step when the theme changes mid-session.
 */
function applyManifestTheme(theme: "dark" | "light") {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const href = `/manifest.webmanifest?theme=${theme}`;
  // Only on a real change — assigning href re-fetches the manifest, and an
  // installed app re-reading it on every branding tick is pure noise.
  if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

/**
 * Apply the document-level parts of the installed-app identity.
 *
 * THE TITLE BAR IS A META TAG, NOT THE MANIFEST. An installed PWA paints its
 * window title bar (the Window Controls Overlay on desktop, the status bar on
 * Android) from the PAGE's `<meta name="theme-color">`, and that overrides the
 * manifest's `theme_color` the moment the page loads. index.html ships a static
 * placeholder for the pre-boot frame; leaving it there meant every tenant got
 * that same off-white bar around their own app, no matter what the manifest
 * said. Nothing in the app updated it — this does.
 *
 * Called on every branding change, so the editor's colour picker moves the real
 * title bar while you drag it, not after a reinstall.
 */
export function applyPwaDocument(cfg: EffectivePwa) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // The LIVE theme, not the tenant's default: the manifest had to guess before
  // our code ran, and this is where the guess gets corrected. `.dark` is what
  // lib/theme-mode.ts writes, including for "system".
  const theme = root.classList.contains("dark") ? "dark" : "light";
  const bar = resolveTitlebar(cfg, theme);

  // The strip behind the caption buttons. Must equal `--titlebar-bg` below or
  // the window shows a seam where the OS's paint meets the page's.
  setThemeColor(bar.base);
  // And the value the NEXT load's frame is painted from, before this runs.
  applyManifestTheme(theme);

  root.style.setProperty("--titlebar-bg", bar.base);
  // Remembered per theme so the NEXT cold start paints the right colour before
  // any network call resolves. Without it the pre-boot bar in index.html can
  // only guess, and guessing white on a dark-themed workspace is a flash of the
  // wrong colour in the first thing anyone sees. Per theme rather than one
  // value because the user may switch between sessions.
  try {
    localStorage.setItem(`praxis.titlebar.${theme}`, bar.base);
  } catch {
    /* private mode — the pre-boot bar falls back to the token default */
  }
  root.style.setProperty(
    "--titlebar-image",
    bar.imageUrl ? `url("${cssUrl(bar.imageUrl)}")` : "none",
  );
  root.style.setProperty(
    "--titlebar-image-opacity",
    bar.imageUrl ? String(bar.opacity) : "0",
  );
  root.style.setProperty("--titlebar-image-blur", `${bar.blur}px`);

  // iOS home-screen label. Static "Praxis LS" in index.html, so every tenant's
  // icon was captioned with the vendor's name until now.
  const title = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]',
  );
  if (title) title.content = cfg.shortName;
}

/** Public — resolved by Host, no auth. The boot splash reads this pre-login. */
export const fetchPwaConfig = () =>
  tenant<PwaConfig>("/branding/pwa", { auth: false });

/** Gated(edit). Upserts only the provided fields; returns the merged result. */
export const savePwaConfig = (patch: Partial<PwaConfig>) =>
  tenant<PwaConfig>("/branding/pwa", { method: "PUT", body: patch });

/** Gated(edit). Uploads a base64 app-icon data URL; returns its /media URL.
 *  Separate from the logo upload because the size cap is different (2 MB — an
 *  app icon wants to be at least 512px square). */
export const uploadAppIcon = (dataUrl: string) =>
  tenant<{ iconUrl: string }>("/branding/pwa/icon", {
    method: "POST",
    body: { dataUrl },
  });

/** Gated(edit). Title-bar artwork. Reuses the app-icon endpoint — same tenant
 *  namespace, same public /media segment, same 2 MB cap — and only the field it
 *  is assigned to differs. */
export const uploadTitlebarImage = async (dataUrl: string) =>
  (await uploadAppIcon(dataUrl)).iconUrl;
