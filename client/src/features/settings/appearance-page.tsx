/**
 * Appearance (white-label). Bound to the real backend contract
 * (`GET/PUT /branding`, branding.service.js): identity, the full colour token
 * set, logo / alt-logo / favicon, typography, corner radius, and theme mode —
 * every field persists. Saving re-applies branding live via the branding
 * context (primary/foreground re-tint immediately through theme.ts).
 */
import * as React from "react";
import { useBranding } from "@/app/branding/branding-context";
import { saveBranding, type Branding } from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field, Segmented, ColorRow, ImageField } from "@/components/settings/controls";

const COLORS: { key: keyof Branding; token: string }[] = [
  { key: "primary", token: "primary" },
  { key: "primaryForeground", token: "primary-fg" },
  { key: "secondary", token: "secondary" },
  { key: "accent", token: "accent" },
  { key: "accentDeep", token: "accent-deep" },
  { key: "accentGlow", token: "accent-glow" },
  { key: "info", token: "info" },
  { key: "success", token: "success" },
  { key: "warn", token: "warn" },
  { key: "danger", token: "danger" },
];

export function AppearancePage() {
  const { branding, setBranding, ready } = useBranding();

  const [name, setName] = React.useState(branding.name || "");
  const [theme, setTheme] = React.useState<"dark" | "light">(branding.theme || "dark");
  const [colors, setColors] = React.useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const { key } of COLORS) seed[key] = (branding[key] as string | null) || "";
    return seed;
  });
  const [logoUrl, setLogoUrl] = React.useState(branding.logoUrl || "");
  const [logoAltUrl, setLogoAltUrl] = React.useState(branding.logoAltUrl || "");
  const [faviconUrl, setFaviconUrl] = React.useState(branding.faviconUrl || "");
  const [fontDisplay, setFontDisplay] = React.useState(branding.fontDisplay || "");
  const [fontBody, setFontBody] = React.useState(branding.fontBody || "");
  const [fontMono, setFontMono] = React.useState(branding.fontMono || "");
  const [radius, setRadius] = React.useState(branding.radius || "");

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // The form fields are seeded from `branding` at mount. On a hard reload this
  // component can mount BEFORE the public GET /branding resolves, so it captures
  // the defaults ("Praxis LS" + default colours). Re-seed the fields once, when
  // branding becomes ready, so they reflect the tenant's saved values instead of
  // staying stuck on defaults. Guarded so a later save/edit is never clobbered.
  const syncedRef = React.useRef(false);
  React.useEffect(() => {
    if (!ready || syncedRef.current) return;
    syncedRef.current = true;
    setName(branding.name || "");
    setTheme(branding.theme || "dark");
    const seed: Record<string, string> = {};
    for (const { key } of COLORS) seed[key] = (branding[key] as string | null) || "";
    setColors(seed);
    setLogoUrl(branding.logoUrl || "");
    setLogoAltUrl(branding.logoAltUrl || "");
    setFaviconUrl(branding.faviconUrl || "");
    setFontDisplay(branding.fontDisplay || "");
    setFontBody(branding.fontBody || "");
    setFontMono(branding.fontMono || "");
    setRadius(branding.radius || "");
  }, [ready, branding]);

  const setColor = (k: string, v: string) => setColors((c) => ({ ...c, [k]: v }));
  const primary = colors.primary || "#0f766e";

  async function onSave() {
    setBusy(true);
    setMsg(null);
    const patch: Partial<Branding> = {
      name: name || null,
      theme,
      logoUrl: logoUrl || null,
      logoAltUrl: logoAltUrl || null,
      faviconUrl: faviconUrl || null,
      fontDisplay: fontDisplay || null,
      fontBody: fontBody || null,
      fontMono: fontMono || null,
      radius: radius || null,
    };
    const colorPatch = patch as Record<string, string | null>;
    for (const { key } of COLORS) colorPatch[key] = colors[key] || null;
    try {
      const saved = await saveBranding(patch);
      setBranding(saved); // re-tints the app immediately
      setMsg({ kind: "ok", text: "Saved. Branding is live across the app." });
    } catch (err) {
      setMsg({
        kind: "err",
        text:
          err instanceof ApiError && err.status === 403
            ? "You need the Settings edit permission to change branding."
            : err instanceof ApiError
              ? err.message
              : "Couldn't save. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl animate-fade-in pb-24">
      <h1 className="font-display text-2xl tracking-tight">Appearance</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        White-label the workspace — identity, colours, logos, type. Changes apply on save.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <SettingsCard title="Identity" desc="Shown across the app and on the login screen.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Smart Logistics" />
            </Field>
            <Field label="Theme mode">
              <Segmented
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Colours" desc="The brand token set. Primary re-tints the app immediately on save.">
          <div className="grid gap-2 sm:grid-cols-2">
            {COLORS.map(({ key, token }) => (
              <ColorRow key={key} token={token} value={colors[key] || "#000000"} onChange={(v) => setColor(key, v)} />
            ))}
          </div>
        </SettingsCard>

        <SettingsCard title="Logos & favicon" desc="Transparent PNG/WEBP recommended, ≤512 KB.">
          <div className="grid gap-4 sm:grid-cols-3">
            <ImageField label="Logo" value={logoUrl} onChange={setLogoUrl} />
            <ImageField label="Alt logo (for light/dark)" value={logoAltUrl} onChange={setLogoAltUrl} />
            <ImageField label="Favicon" value={faviconUrl} onChange={setFaviconUrl} shape="square" />
          </div>
        </SettingsCard>

        <SettingsCard title="Typography & shape" desc="Font families (CSS names) and corner radius.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display font">
              <Input value={fontDisplay} onChange={(e) => setFontDisplay(e.target.value)} placeholder="Playfair Display, serif" />
            </Field>
            <Field label="Body font">
              <Input value={fontBody} onChange={(e) => setFontBody(e.target.value)} placeholder="Montserrat, sans-serif" />
            </Field>
            <Field label="Mono font">
              <Input value={fontMono} onChange={(e) => setFontMono(e.target.value)} placeholder="JetBrains Mono, monospace" />
            </Field>
            <Field label="Corner radius">
              <Input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="18px" />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Preview" desc="Live — reflects name, colours, logos, typography, corner radius and theme mode.">
          {(() => {
            const c = (k: string, fb: string) => colors[k] || fb;
            const radiusVal = radius || "12px";
            const isDark = theme === "dark";
            const pv = {
              "--pv-primary": primary,
              "--pv-primary-fg": c("primaryForeground", "#ffffff"),
              "--pv-secondary": c("secondary", "#1c9bd7"),
              "--pv-accent": c("accent", "#f5821f"),
              "--pv-info": c("info", "#2f6feb"),
              "--pv-success": c("success", "#16a34a"),
              "--pv-warn": c("warn", "#d97706"),
              "--pv-danger": c("danger", "#dc2626"),
              borderRadius: radiusVal,
              fontFamily: fontBody || "inherit",
              color: isDark ? "#e5e7eb" : "#0f172a",
              background: isDark ? "#0b1220" : "#ffffff",
              borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)",
            } as React.CSSProperties;
            const pill = (label: string, v: string) => (
              <span
                key={label}
                className="px-2 py-0.5 text-[11px] font-semibold"
                style={{ borderRadius: 999, background: `${v}22`, color: v }}
              >
                {label}
              </span>
            );
            return (
              <div className="space-y-4 border p-4" style={pv}>
                {/* Top bar: logo/avatar + name + primary/secondary actions */}
                <div className="flex items-center gap-3">
                  {logoUrl ? (
                    <img src={logoUrl} alt="" className="h-10 w-auto" style={{ borderRadius: radiusVal }} />
                  ) : (
                    <span
                      className="flex h-10 w-10 items-center justify-center text-lg font-semibold"
                      style={{ background: primary, color: "var(--pv-primary-fg)" as string, borderRadius: radiusVal, fontFamily: fontDisplay || "inherit" }}
                    >
                      {(name || "P").charAt(0)}
                    </span>
                  )}
                  <div className="flex-1 text-lg font-semibold" style={{ fontFamily: fontDisplay || "inherit" }}>
                    {name || "Praxis LS"}
                  </div>
                  <button className="px-3 py-1.5 text-sm font-semibold" style={{ background: primary, color: "var(--pv-primary-fg)" as string, borderRadius: radiusVal }}>
                    Primary
                  </button>
                  <button className="px-3 py-1.5 text-sm font-semibold" style={{ background: "var(--pv-secondary)" as string, color: "#fff", borderRadius: radiusVal }}>
                    Secondary
                  </button>
                </div>

                {/* Typography samples */}
                <div className="space-y-1">
                  <div className="text-base font-semibold" style={{ fontFamily: fontDisplay || "inherit" }}>
                    Display heading — {fontDisplay || "default"}
                  </div>
                  <p className="text-sm opacity-80" style={{ fontFamily: fontBody || "inherit" }}>
                    Body text in {fontBody || "the default font"}. The quick brown fox clears customs at Douala.
                  </p>
                  <code className="text-xs opacity-80" style={{ fontFamily: fontMono || "monospace" }}>
                    SLAS-2026-0142 · 12,000,000 XAF
                  </code>
                </div>

                {/* Status tokens */}
                <div className="flex flex-wrap gap-1.5">
                  {pill("Info", c("info", "#2f6feb"))}
                  {pill("Success", c("success", "#16a34a"))}
                  {pill("Warning", c("warn", "#d97706"))}
                  {pill("Danger", c("danger", "#dc2626"))}
                  <span className="px-2 py-0.5 text-[11px] font-semibold" style={{ borderRadius: 999, background: "var(--pv-accent)" as string, color: "#fff" }}>
                    Accent
                  </span>
                </div>

                {/* A card using the radius + accent edge */}
                <div className="p-3 text-sm" style={{ borderRadius: radiusVal, borderLeft: `3px solid ${c("accent", "#f5821f")}`, background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" }}>
                  Card surface · {radiusVal} radius · {isDark ? "dark" : "light"} theme
                </div>
              </div>
            );
          })()}
        </SettingsCard>

        {msg && (
          <p
            className={
              msg.kind === "ok"
                ? "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                : "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            }
          >
            {msg.text}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/90 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
          <Button loading={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default AppearancePage;
