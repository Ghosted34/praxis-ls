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
  const { branding, setBranding } = useBranding();

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
            ? "You need the Settings (MOD-70) edit permission to change branding."
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

        <SettingsCard title="Preview" desc="Reflects name, primary colour and logo.">
          <div className="flex items-center gap-4 rounded-lg border p-4">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-10 w-auto" />
            ) : (
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl font-display text-lg text-white"
                style={{ background: primary }}
              >
                {(name || "P").charAt(0)}
              </span>
            )}
            <div className="flex-1 font-display text-lg">{name || "Praxis LS"}</div>
            <button className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: primary }}>
              Primary action
            </button>
          </div>
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
