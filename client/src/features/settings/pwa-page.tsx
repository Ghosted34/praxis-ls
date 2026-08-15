/**
 * App & PWA — the tenant's INSTALLED app.
 *
 * Appearance (settings/appearance-page.tsx) governs how the product looks once
 * you are inside it. This screen governs what it is when it leaves the browser:
 * the icon the operating system puts on a home screen, the name under it, the
 * screen that shows while it starts, and the wording of the install, offline and
 * update prompts. They are separate screens because they are separate jobs — the
 * wide wordmark that belongs in a sidebar is almost never the right thing to
 * crop into a circle — and because everything here has a manifest-shaped
 * consequence that the in-app token layer does not.
 *
 * NOTHING IS REQUIRED. Every field inherits: an unset name falls back to the
 * brand name, an unset colour to the brand primary, an unset icon to the brand
 * logo. Text inputs show what they inherit as their placeholder, so "empty"
 * always reads as "same as the brand" rather than as "missing". That is what
 * makes this screen safe to open and close without changing anything.
 *
 * TENANT ISOLATION. Everything here writes to this tenant's own `setting` rows
 * and this tenant's own `tenant_<slug>/` storage namespace, and the manifest is
 * served per origin from the Host header (src/routes/pwa.js). There is no
 * cross-tenant read path to get wrong: one workspace cannot address, fetch or
 * render another's icon.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/ui/callout";
// Two `Field`s, on purpose. `FormField` (ui/modal) is the one that ASSOCIATES a
// label with a single control — id, htmlFor, aria-describedby — and every plain
// input here uses it. `Field` (settings/controls) is a visual label for a GROUP
// of controls, like a colour swatch next to a reset button; those carry their
// own aria-labels because a group has no single control to point a label at.
import { Field as FormField } from "@/components/ui/modal";
import {
  SettingsCard,
  Field,
  Segmented,
  Toggle,
  Slider,
  ImageField,
} from "@/components/settings/controls";
import { useBranding } from "@/app/branding/branding-context";
import { ApiError } from "@/lib/api-client";
import {
  brandSource,
  effectivePwa,
  savePwaConfig,
  uploadAppIcon,
  uploadTitlebarImage,
  PWA_RANGES,
  type PwaConfig,
  type EffectivePwa,
} from "@/lib/pwa-config";
import { cn } from "@/lib/cn";
import {
  AppIcon,
  HomeScreenPreview,
  MaskRow,
  MaskLegend,
  TitleBarPreview,
  TitleBarStatus,
} from "./pwa/previews";
import { SplashPreview } from "./pwa/splash-preview";
import {
  iconWarnings,
  splashWarnings,
  manifestWarnings,
  type PwaWarning,
  type SourceMeta,
} from "./pwa/validation";

const TABS = [
  { value: "icon", label: "Icon" },
  { value: "identity", label: "Identity" },
  { value: "titlebar", label: "Title bar" },
  { value: "splash", label: "Splash" },
  { value: "install", label: "Install" },
  { value: "offline", label: "Offline" },
];

const SPLASH_PRESETS: {
  value: NonNullable<PwaConfig["splashPreset"]>;
  label: string;
  desc: string;
}[] = [
  { value: "none", label: "None", desc: "Static. The mark simply appears." },
  {
    value: "fade",
    label: "Fade",
    desc: "A short rise and fade-in. The quiet default.",
  },
  {
    value: "pulse",
    label: "Pulse",
    desc: "The mark breathes while the app loads.",
  },
  {
    value: "shimmer",
    label: "Shimmer",
    desc: "A light sweep crosses the mark.",
  },
  {
    value: "ring",
    label: "Ring",
    desc: "A brand-coloured arc orbits the mark.",
  },
  {
    value: "mesh",
    label: "Mesh",
    desc: "Soft brand blooms drift behind a still mark.",
  },
];

/** Two-column editor: controls, and the evidence for them. The preview column
 *  sticks so it stays in view while the sliders are being worked. */
function Split({
  children,
  preview,
}: {
  children: React.ReactNode;
  preview: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="lux-card flex flex-col items-center gap-4 p-5">
          {preview}
        </div>
      </div>
    </div>
  );
}

function Warnings({ items }: { items: PwaWarning[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((w) => (
        <Callout
          key={w.id}
          tone={w.tone === "warn" ? "warn" : "info"}
          title={w.title}
        >
          {w.detail}
        </Callout>
      ))}
    </div>
  );
}

export function PwaPage() {
  const { branding, ready, pwaConfig, setPwaConfig } = useBranding();
  const [tab, setTab] = React.useState("icon");
  const [draft, setDraft] = React.useState<PwaConfig>(pwaConfig);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [safeZone, setSafeZone] = React.useState(true);
  const [source, setSource] = React.useState<SourceMeta>(null);

  // Re-seed once the public fetch lands — this screen can mount before it does,
  // and a form seeded from the pre-fetch defaults would save those defaults over
  // the tenant's real configuration on the first click. Same guard as Appearance.
  const syncedRef = React.useRef(false);
  React.useEffect(() => {
    if (!ready || syncedRef.current) return;
    syncedRef.current = true;
    setDraft(pwaConfig);
  }, [ready, pwaConfig]);

  // Everything below previews from the SAME resolver the API renders from, so
  // what is on screen is what the device will get.
  const cfg: EffectivePwa = React.useMemo(
    () => effectivePwa(draft, brandSource(branding)),
    [draft, branding],
  );

  // Measure the source image so the checks can talk about real pixels ("it's
  // 400×120") instead of generalities. Runs for a pasted URL too, not just an
  // upload — the field accepts both.
  React.useEffect(() => {
    if (!cfg.iconUrl) return setSource(null);
    let live = true;
    const img = new Image();
    img.onload = () =>
      live && setSource({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => live && setSource(null);
    img.src = cfg.iconUrl;
    return () => {
      live = false;
    };
  }, [cfg.iconUrl]);

  const set = <K extends keyof PwaConfig>(key: K, value: PwaConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  /** Sliders are always concrete — the editor shows the inherited value and the
   *  tenant moves it, so there is no "unset" state to preserve. */
  const num = (key: keyof PwaConfig, current: number) => ({
    value: current,
    onChange: (v: number) => set(key, v as PwaConfig[typeof key]),
    min: PWA_RANGES[key]?.[0] ?? 0,
    max: PWA_RANGES[key]?.[1] ?? 100,
  });
  /** Text fields store null for empty, which is what "inherit" means. */
  const text = (key: keyof PwaConfig) => ({
    value: (draft[key] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(key, (e.target.value || null) as PwaConfig[typeof key]),
  });

  const iconIssues = React.useMemo(
    () => iconWarnings(cfg, source),
    [cfg, source],
  );
  const splashIssues = React.useMemo(() => splashWarnings(cfg), [cfg]);
  const manifestIssues = React.useMemo(() => manifestWarnings(cfg), [cfg]);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await savePwaConfig(draft);
      setPwaConfig(saved);
      setDraft(saved);
      setMsg({
        kind: "ok",
        text: "Saved. New installs pick this up immediately; devices that already installed the app refresh their icon when the manifest cache expires.",
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text:
          err instanceof ApiError && err.status === 403
            ? "You need the Settings edit permission to change the app design."
            : err instanceof ApiError
              ? err.message
              : "Couldn't save. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const iconPanel = (
    <Split
      preview={
        <>
          <MaskRow cfg={cfg} safeZone={safeZone} />
          <MaskLegend />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={safeZone}
              onChange={(e) => setSafeZone(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            Show the maskable safe zone
          </label>
          <HomeScreenPreview cfg={cfg} mask="circle" />
        </>
      }
    >
      <SettingsCard
        title="Source image"
        desc="A square PNG or SVG, at least 512×512. This is the mark the operating system puts on a home screen — it does not have to be your sidebar logo, and usually shouldn't be."
      >
        <div className="flex flex-col gap-4">
          <ImageField
            label="App icon"
            value={draft.iconUrl || ""}
            onChange={(url) => set("iconUrl", url || null)}
            shape="square"
            maxBytes={2_000_000}
            upload={async (dataUrl) => (await uploadAppIcon(dataUrl)).iconUrl}
            hint={
              draft.iconUrl
                ? undefined
                : `Not set — inheriting your brand logo${branding.logoUrl ? "" : " (which isn't set either, so a letter mark is used)"}.`
            }
          />
          <Warnings items={iconIssues} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Framing"
        desc="How the artwork sits inside the tile. The safe-zone padding applies to the maskable variant — the one Android crops."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider
            label="Zoom"
            unit="%"
            step={1}
            {...num("iconZoom", cfg.iconZoom)}
          />
          <Slider
            label="Safe-zone padding"
            unit="%"
            {...num("maskablePadding", cfg.maskablePadding)}
            hint="20% is the platform recommendation."
          />
          <Slider
            label="Nudge left / right"
            unit="%"
            {...num("iconOffsetX", cfg.iconOffsetX)}
          />
          <Slider
            label="Nudge up / down"
            unit="%"
            {...num("iconOffsetY", cfg.iconOffsetY)}
          />
          <Slider
            label="Padding (plain icon)"
            unit="%"
            {...num("iconPadding", cfg.iconPadding)}
            hint="Used where the icon isn't cropped — iOS, desktop, the install dialog."
          />
          <Slider
            label="Corner rounding (plain icon)"
            unit="%"
            {...num("iconRadius", cfg.iconRadius)}
            hint="Ignored on the maskable variant: the launcher supplies the shape."
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Backgrounds"
        desc="What sits behind the artwork in each variant."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Plain icon background">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Plain icon background colour"
                value={
                  cfg.iconBackground === "transparent"
                    ? "#ffffff"
                    : cfg.iconBackground
                }
                onChange={(e) => set("iconBackground", e.target.value)}
                className="h-8 w-8 flex-none cursor-pointer rounded border bg-transparent p-0.5"
              />
              <Button
                type="button"
                variant={
                  cfg.iconBackground === "transparent" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  set(
                    "iconBackground",
                    cfg.iconBackground === "transparent"
                      ? "#ffffff"
                      : "transparent",
                  )
                }
              >
                Transparent
              </Button>
            </div>
          </Field>
          <Field label="Maskable background">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Maskable icon background colour"
                value={cfg.maskableBackground}
                onChange={(e) => set("maskableBackground", e.target.value)}
                className="h-8 w-8 flex-none cursor-pointer rounded border bg-transparent p-0.5"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("maskableBackground", null)}
              >
                Use brand colour
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Always opaque — a transparent maskable icon shows the wallpaper
              through the crop.
            </p>
          </Field>
        </div>
      </SettingsCard>
    </Split>
  );

  const identityPanel = (
    <Split
      preview={
        <>
          <AppIcon cfg={cfg} size={84} />
          <div className="text-center">
            <p className="font-display text-base">{cfg.name}</p>
            <p className="micro mt-0.5">Home screen label: {cfg.shortName}</p>
          </div>
          <dl className="w-full space-y-1 text-xs">
            {[
              ["display", cfg.display],
              ["orientation", cfg.orientation],
              ["theme_color", cfg.themeColor],
              ["background_color", cfg.backgroundColor],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      }
    >
      <SettingsCard
        title="Names"
        desc="What the install dialog, the home-screen label and the app switcher show."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="App name">
            <Input
              {...text("appName")}
              placeholder={branding.name || "Praxis LS"}
              maxLength={60}
            />
          </FormField>
          <FormField label="Short name">
            <Input
              {...text("shortName")}
              placeholder={cfg.name.slice(0, 12)}
              maxLength={12}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">
              <Textarea
                {...text("description")}
                placeholder={cfg.description}
                rows={2}
                maxLength={300}
              />
            </FormField>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Window" desc="How the installed app opens.">
        <div className="flex flex-col gap-4">
          <FormField label="Display mode">
            <Segmented
              value={cfg.display}
              onChange={(v) => set("display", v)}
              options={[
                { value: "standalone", label: "Standalone" },
                { value: "fullscreen", label: "Full screen" },
                { value: "minimal-ui", label: "Minimal UI" },
                { value: "browser", label: "Browser" },
              ]}
            />
          </FormField>
          <FormField label="Orientation">
            <Segmented
              value={cfg.orientation}
              onChange={(v) => set("orientation", v)}
              options={[
                { value: "any", label: "Any" },
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
            />
          </FormField>
          <Warnings items={manifestIssues} />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Colours"
        desc="The system chrome around the app, and the plate the operating system paints while it launches."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Theme colour">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Theme colour"
                value={cfg.themeColor}
                onChange={(e) => set("themeColor", e.target.value)}
                className="h-8 w-8 flex-none cursor-pointer rounded border bg-transparent p-0.5"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("themeColor", null)}
              >
                Use brand colour
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("themeColor", cfg.backgroundColor)}
              >
                Match app
              </Button>
            </div>
            {/* This is the one manifest field whose effect is invisible from
                    inside a browser tab, so say where it lands. */}
            <p className="text-[11px] text-muted-foreground">
              Paints the desktop title bar and the Android status bar. Your
              brand colour is bold there; matching the app background makes the
              window look continuous instead.
            </p>
          </Field>
          <Field label="Launch background">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Launch background colour"
                value={cfg.backgroundColor}
                onChange={(e) => set("backgroundColor", e.target.value)}
                className="h-8 w-8 flex-none cursor-pointer rounded border bg-transparent p-0.5"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("backgroundColor", null)}
              >
                Follow theme
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Painted by the OS before any of your code runs, so it should match
              the splash background.
            </p>
          </Field>
        </div>
      </SettingsCard>
    </Split>
  );

  const splashPanel = (
    <Split preview={<SplashPreview cfg={cfg} />}>
      <SettingsCard
        title="Launch screen"
        desc="Shown while the app starts. The operating system paints a still plate first (that's the launch background); this is what your app draws over it."
      >
        <div className="flex flex-col gap-4">
          <Toggle
            checked={cfg.splashEnabled}
            onChange={(v) => set("splashEnabled", v)}
            label="Show a branded launch screen"
            hint="Off means the app goes straight to the sign-in screen."
          />
          <Warnings items={splashIssues} />
        </div>
      </SettingsCard>

      {cfg.splashEnabled && (
        <>
          <SettingsCard
            title="Animation"
            desc="Pick one and watch it in the preview."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {SPLASH_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set("splashPreset", p.value)}
                  aria-pressed={cfg.splashPreset === p.value}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors hover:bg-accent/40",
                    cfg.splashPreset === p.value &&
                      "border-primary bg-accent/50",
                  )}
                >
                  <span className="block text-sm font-semibold text-foreground">
                    {p.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {p.desc}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Every preset falls back to its still composition for anyone whose
              device asks for reduced motion.
            </p>
          </SettingsCard>

          <SettingsCard
            title="Content"
            desc="What appears on the launch screen, and for how long."
          >
            <div className="flex flex-col gap-4">
              <FormField label="Tagline">
                <Input
                  {...text("splashTagline")}
                  placeholder={cfg.splashTagline}
                  maxLength={60}
                />
              </FormField>
              <Field label="Background">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Splash background colour"
                    value={cfg.splashBackground}
                    onChange={(e) => set("splashBackground", e.target.value)}
                    className="h-8 w-8 flex-none cursor-pointer rounded border bg-transparent p-0.5"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set("splashBackground", null)}
                  >
                    Reset
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    Text colour is chosen automatically for contrast.
                  </span>
                </div>
              </Field>
              <Slider
                label="Minimum hold"
                unit="ms"
                step={50}
                {...num("splashDuration", cfg.splashDuration)}
                hint="How long it stays up even when the app is ready sooner. This is waiting time, so keep it short."
              />
              <Toggle
                checked={cfg.splashShowProgress}
                onChange={(v) => set("splashShowProgress", v)}
                label="Show the progress bar"
              />
            </div>
          </SettingsCard>
        </>
      )}
    </Split>
  );

  const installPanel = (
    <Split
      preview={
        <div className="w-full">
          <p className="micro mb-2">Install prompt</p>
          <div className="flex items-start gap-3 rounded-2xl border bg-popover p-3.5 shadow-l">
            <AppIcon cfg={cfg} size={40} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {cfg.installTitle || `Install ${cfg.name}`}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                {cfg.installBody ||
                  `Add ${cfg.name} to your device for a faster, full-screen app that works offline.`}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground">
                  {cfg.installButton || "Install"}
                </span>
                <span className="px-3 py-1.5 text-sm text-muted-foreground">
                  Not now
                </span>
              </div>
            </div>
          </div>
          <p className="micro mb-2 mt-5">On iOS</p>
          <div className="rounded-2xl border bg-popover p-3.5 text-[13px] leading-snug text-muted-foreground shadow-l">
            {cfg.installIosBody ||
              `Tap Share, then Add to Home Screen to use ${cfg.name} like an app — full screen, on your home screen.`}
          </div>
        </div>
      }
    >
      <SettingsCard
        title="Install prompt"
        desc="The banner offering to add the app to a device. Android and desktop Chromium get a real install button; iOS can only be told where the Share menu is, because Apple provides no install API."
      >
        <div className="flex flex-col gap-4">
          <Toggle
            checked={cfg.installEnabled}
            onChange={(v) => set("installEnabled", v)}
            label="Show the install prompt"
            hint="Staff can still install from the account menu when this is off."
          />
          <FormField label="Title">
            <Input
              {...text("installTitle")}
              placeholder={`Install ${cfg.name}`}
              maxLength={60}
            />
          </FormField>
          <FormField label="Body">
            <Textarea
              {...text("installBody")}
              rows={2}
              placeholder={`Add ${cfg.name} to your device for a faster, full-screen app that works offline.`}
              maxLength={200}
            />
          </FormField>
          <FormField label="Body (iOS)">
            <Textarea
              {...text("installIosBody")}
              rows={2}
              placeholder="Tap Share, then Add to Home Screen…"
              maxLength={200}
            />
          </FormField>
          <FormField label="Button">
            <Input
              {...text("installButton")}
              placeholder="Install"
              maxLength={24}
            />
          </FormField>
        </div>
      </SettingsCard>
    </Split>
  );

  const offlinePanel = (
    <Split
      preview={
        <div className="flex w-full flex-col gap-5">
          <div>
            <p className="micro mb-2">Offline</p>
            <div className="flex items-center gap-2 rounded-full border bg-popover px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground shadow-m">
              <span
                className="h-2 w-2 rounded-full bg-[rgb(var(--warn))]"
                aria-hidden
              />
              {cfg.offlineText ||
                "You're offline — some data may be out of date."}
            </div>
          </div>
          <div>
            <p className="micro mb-2">Update available</p>
            <div className="flex items-center gap-3 rounded-xl border bg-popover p-3 pl-4 shadow-l">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {cfg.updateTitle || "New version available"}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {cfg.updateBody || "Reload to get the latest update."}
                </p>
              </div>
              <span className="flex-none rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground">
                {cfg.updateButton || "Reload"}
              </span>
            </div>
          </div>
          <div>
            <p className="micro mb-2">Ready offline</p>
            <div className="rounded-xl border bg-popover p-3 pl-4 text-sm font-medium text-foreground shadow-l">
              {cfg.offlineReadyText || "Ready to work offline."}
            </div>
          </div>
        </div>
      }
    >
      <SettingsCard
        title="Offline & updates"
        desc="Wording only. When these appear is decided by the service worker — going offline, and a new build finishing its download — and is not a design choice."
      >
        <div className="flex flex-col gap-4">
          <FormField label="Offline notice">
            <Input
              {...text("offlineText")}
              placeholder="You're offline — some data may be out of date."
              maxLength={120}
            />
          </FormField>
          <FormField label="Ready-offline confirmation">
            <Input
              {...text("offlineReadyText")}
              placeholder="Ready to work offline."
              maxLength={120}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Update title">
              <Input
                {...text("updateTitle")}
                placeholder="New version available"
                maxLength={60}
              />
            </FormField>
            <FormField label="Update button">
              <Input
                {...text("updateButton")}
                placeholder="Reload"
                maxLength={24}
              />
            </FormField>
          </div>
          <FormField label="Update body">
            <Input
              {...text("updateBody")}
              placeholder="Reload to get the latest update."
              maxLength={120}
            />
          </FormField>
        </div>
      </SettingsCard>
    </Split>
  );

  /**
   * Title bar. The one surface here that only exists once the app is INSTALLED:
   * with window-controls-overlay the OS stops drawing a title bar and the page
   * draws it instead, so this is a real design surface rather than a colour
   * field — and it is invisible from the browser tab you are configuring it in,
   * which is why both themes are previewed side by side.
   */
  const titlebarPanel = (
    <Split
      preview={
        <div className="flex w-full flex-col gap-4">
          <TitleBarPreview cfg={cfg} theme="dark" caption="Dark theme" />
          <TitleBarPreview cfg={cfg} theme="light" caption="Light theme" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Both are shown because the bar follows whichever theme the user is
            in — it is not one colour for everyone.
          </p>
        </div>
      }
    >
      <SettingsCard
        title="Colour"
        desc="What the installed window's title bar is painted with. It also colours the small strip the operating system keeps behind the minimise, maximise and close buttons, so the two never disagree."
      >
        <div className="flex flex-col gap-4">
          <Field label="Treatment">
            <Segmented
              value={cfg.titlebarMode}
              onChange={(v) => set("titlebarMode", v)}
              options={[
                { value: "surface", label: "Match app" },
                { value: "brand", label: "Brand colour" },
                { value: "custom", label: "Custom" },
              ]}
            />
            <p className="text-[11px] text-muted-foreground">
              {cfg.titlebarMode === "surface"
                ? "Follows your app's own surface in each theme — the window reads as one continuous instrument."
                : cfg.titlebarMode === "brand"
                  ? "Your brand colour, edge to edge. Bold, and the same in both themes — check it against dark below."
                  : "Two explicit colours, one per theme."}
            </p>
          </Field>

          {cfg.titlebarMode === "custom" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dark theme">
                <input
                  type="color"
                  aria-label="Title bar colour, dark theme"
                  value={cfg.titlebarDark}
                  onChange={(e) => set("titlebarDark", e.target.value)}
                  className="h-8 w-full cursor-pointer rounded border bg-transparent p-0.5"
                />
              </Field>
              <Field label="Light theme">
                <input
                  type="color"
                  aria-label="Title bar colour, light theme"
                  value={cfg.titlebarLight}
                  onChange={(e) => set("titlebarLight", e.target.value)}
                  className="h-8 w-full cursor-pointer rounded border bg-transparent p-0.5"
                />
              </Field>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Artwork"
        desc="An optional image behind the bar. It sits on its own layer under the text, so keep it as texture — a low opacity and a wide, quiet image. Anything busy competes with the controls sitting on top of it."
      >
        <div className="flex flex-col gap-4">
          <ImageField
            label="Background image"
            value={draft.titlebarImageUrl || ""}
            onChange={(url) => set("titlebarImageUrl", url || null)}
            shape="wide"
            maxBytes={2_000_000}
            upload={uploadTitlebarImage}
            hint="Wide and low — the bar is roughly 1600×44 on a laptop, so a tall image will only ever show its middle band."
          />
          {cfg.titlebarImageUrl && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Slider
                label="Opacity"
                unit="%"
                {...num("titlebarImageOpacity", cfg.titlebarImageOpacity)}
                hint="Capped at 60% — above that, text on the bar starts to lose contrast."
              />
              <Slider
                label="Blur"
                unit="px"
                {...num("titlebarBlur", cfg.titlebarBlur)}
                hint="Softens detail into texture. A little goes a long way."
              />
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Where this shows"
        desc="Installed windows only, on desktop Chromium (Windows, macOS, Linux, ChromeOS)."
      >
        <div className="flex flex-col gap-3">
          <Warnings
            items={manifestIssues.filter(
              (w) => w.id === "display-blocks-titlebar",
            )}
          />
          <TitleBarStatus />
          <p className="text-sm text-muted-foreground">
            In a browser tab there is no title bar to take over, so this row
            renders as the app's ordinary utility bar and the colour applies to
            the browser's own theming instead. On mobile the same colour tints
            the status bar. Nothing here can leave the app without a usable
            header.
          </p>
        </div>
      </SettingsCard>
    </Split>
  );

  const PANELS: Record<string, React.ReactNode> = {
    icon: iconPanel,
    titlebar: titlebarPanel,
    identity: identityPanel,
    splash: splashPanel,
    install: installPanel,
    offline: offlinePanel,
  };

  return (
    <section className={cn(pageShell.wide, "pb-24")}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="App & PWA"
        description="How your workspace looks once it's installed — the home-screen icon, the launch screen, and the prompts around installing and going offline."
        action={
          <Button onClick={onSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        }
      />

      {/* There is one installed app per workspace, so this screen is the same in
          Test and Live (see branding.controller.js). Said here, unprompted,
          because the environment banner sits directly above it and "I am in
          TEST" would otherwise imply "this is not real" — the opposite of the
          truth. */}
      <div className="mb-4">
        <Callout tone="info" title="Same in Test and Live.">
          A workspace has one installed app, so there is nothing to sandbox here
          — saving applies to the real app in both environments.
        </Callout>
      </div>

      {msg && (
        <div className="mb-4">
          <Callout tone={msg.kind === "ok" ? "ok" : "bad"}>{msg.text}</Callout>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={setTab}
        label="App and PWA sections"
        tabs={TABS.map((t) => ({ ...t, content: PANELS[t.value] }))}
      />
    </section>
  );
}
