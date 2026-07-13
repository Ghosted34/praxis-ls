/**
 * Appearance (white-label) — pixie "App Appearance" spec, two layers:
 *   A) Platform: product identity, logos + favicon, theme presets, the full
 *      light/dark token bag + alpha/mesh sliders, typography, live preview.
 *   B) Per-business: accent + gradient + logo + website for each business line.
 *
 * Persistence: the backend (branding.service.js) stores name / primary /
 * logoUrl today; the rest are sent on Save and marked "pending backend" until
 * the appearance schema is extended (see doc/FE_IA_HANDOFF.md §3). Save applies
 * live via the branding context for the fields the app already consumes.
 */
import * as React from "react";
import { useBranding } from "@/app/branding/branding-context";
import {
  saveBranding,
  type Branding,
  type ThemeTokens,
  type BusinessBrand,
} from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import {
  SettingsCard,
  Field,
  Segmented,
  ColorRow,
  ImageField,
} from "@/components/settings/controls";

const PRESETS = [
  { key: "maroon-noir", label: "Maroon Noir", accent: "#8E2434", hint: "Dark · deep red" },
  { key: "porcelain-white", label: "Porcelain White", accent: "#8E2434", hint: "White · deep red" },
  { key: "onyx-rally", label: "Onyx Rally", accent: "#E4572E", hint: "Neutral black · rally" },
];

const TOKEN_KEYS = [
  "--bg", "--panel", "--panel-2", "--text", "--text-muted", "--text-faint",
  "--border-c", "--accent", "--accent-deep", "--sage", "--info", "--success", "--warn", "--danger", "--rose",
];

const DARK_DEFAULTS: ThemeTokens = {
  "--bg": "#0f0a0c", "--panel": "#1a1113", "--panel-2": "#241619", "--text": "#f4eef0",
  "--text-muted": "#b9a4a9", "--text-faint": "#7c5f66", "--border-c": "#3a2a2e", "--accent": "#e4572e",
  "--accent-deep": "#b8431f", "--sage": "#7fa38b", "--info": "#6aa9d6", "--success": "#4ab078",
  "--warn": "#e0b442", "--danger": "#e86860", "--rose": "#d98a97",
};
const LIGHT_DEFAULTS: ThemeTokens = {
  "--bg": "#f7f4f5", "--panel": "#ffffff", "--panel-2": "#f1eaec", "--text": "#201014",
  "--text-muted": "#6b5257", "--text-faint": "#9a868b", "--border-c": "#e6dadd", "--accent": "#8e2434",
  "--accent-deep": "#6d1a27", "--sage": "#5f7f6b", "--info": "#2f74a4", "--success": "#2a8f5a",
  "--warn": "#b08018", "--danger": "#c2554e", "--rose": "#b06b78",
};

const DISPLAY_FONTS = ["Playfair Display", "Cormorant Garamond", "Georgia"];
const BODY_FONTS = ["Montserrat", "Manrope", "Inter", "system-ui"];
const MONO_FONTS = ["IBM Plex Mono", "JetBrains Mono", "ui-monospace"];

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export function AppearancePage() {
  const { branding, setBranding } = useBranding();

  // Layer A — identity + persisted brand
  const [name, setName] = React.useState(branding.name || "");
  const [companyName, setCompanyName] = React.useState(branding.companyName || "");
  const [tagline, setTagline] = React.useState(branding.tagline || "");
  const [primary, setPrimary] = React.useState(branding.primary || "#8E2434");
  const [logoUrl, setLogoUrl] = React.useState(branding.logoUrl || "");
  const [logoDarkUrl, setLogoDarkUrl] = React.useState(branding.logoDarkUrl || "");
  const [faviconUrl, setFaviconUrl] = React.useState(branding.faviconUrl || "");
  const [themePreset, setThemePreset] = React.useState(branding.themePreset || "");

  // Tokens
  const [tokenMode, setTokenMode] = React.useState<"dark" | "light">("dark");
  const [tokensDark, setTokensDark] = React.useState<ThemeTokens>({ ...DARK_DEFAULTS, ...(branding.tokensDark || {}) });
  const [tokensLight, setTokensLight] = React.useState<ThemeTokens>({ ...LIGHT_DEFAULTS, ...(branding.tokensLight || {}) });
  const [panelAlpha, setPanelAlpha] = React.useState(branding.panelAlpha ?? 0.57);
  const [borderAlpha, setBorderAlpha] = React.useState(branding.borderAlpha ?? 0.4);
  const [meshOpacity, setMeshOpacity] = React.useState(branding.meshOpacity ?? 0.5);

  // Typography
  const [display, setDisplay] = React.useState(branding.typography?.display || "Playfair Display");
  const [body, setBody] = React.useState(branding.typography?.body || "Montserrat");
  const [mono, setMono] = React.useState(branding.typography?.mono || "IBM Plex Mono");
  const [customFontUrl, setCustomFontUrl] = React.useState(branding.typography?.customFontUrl || "");

  // Layer B — businesses
  const [businesses, setBusinesses] = React.useState<BusinessBrand[]>(
    branding.businesses && branding.businesses.length
      ? branding.businesses
      : [{ id: "biz-1", name: name || "Business 1", accent: "#6F822D", gradientStart: "#35D384", gradientEnd: "#A27676" }],
  );
  const [activeBiz, setActiveBiz] = React.useState(0);

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const tokens = tokenMode === "dark" ? tokensDark : tokensLight;
  const setToken = (k: string, v: string) =>
    (tokenMode === "dark" ? setTokensDark : setTokensLight)((prev) => ({ ...prev, [k]: v }));

  function applyPreset(p: (typeof PRESETS)[number]) {
    setThemePreset(p.key);
    setPrimary(p.accent);
  }

  function updateBiz(patch: Partial<BusinessBrand>) {
    setBusinesses((prev) => prev.map((b, i) => (i === activeBiz ? { ...b, ...patch } : b)));
  }

  async function onSave() {
    setBusy(true);
    setMsg(null);
    const patch: Partial<Branding> = {
      name: name || null,
      companyName: companyName || null,
      tagline: tagline || null,
      primary,
      logoUrl: logoUrl || null,
      logoDarkUrl: logoDarkUrl || null,
      faviconUrl: faviconUrl || null,
      themePreset: themePreset || null,
      tokensDark,
      tokensLight,
      panelAlpha,
      borderAlpha,
      meshOpacity,
      typography: { display, body, mono, customFontUrl: customFontUrl || null },
      businesses,
    };
    try {
      const saved = await saveBranding(patch);
      setBranding(saved);
      setMsg({ kind: "ok", text: "Saved. Name, accent & logo are live now; the rest persists once the backend adds the fields." });
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

  const biz = businesses[activeBiz];

  return (
    <section className="mx-auto max-w-4xl animate-fade-in pb-24">
      <div className="mb-1 flex items-center gap-2">
        <span className="micro">Layer A</span>
      </div>
      <h1 className="font-display text-2xl tracking-tight">App Appearance — the platform</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The white-label switch. Logos, fonts, the full token bag — light &amp; dark — applied across the ERP.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        {/* Product identity */}
        <SettingsCard title="Product identity" desc="Names shown across the app and the login screen.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Pixie Hub" />
            </Field>
            <Field label="Company name" soon>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Pixie Girl Global" />
            </Field>
            <Field label="Tagline" soon>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Powering the perfect pixie" />
            </Field>
          </div>
        </SettingsCard>

        {/* Logos */}
        <SettingsCard title="Logos & favicon" desc="Transparent PNG/WEBP recommended. The favicon also seeds app icons.">
          <div className="grid gap-4 sm:grid-cols-3">
            <ImageField label="Logo (light background)" value={logoUrl} onChange={setLogoUrl} hint="Persisted now." />
            <ImageField label="Logo (dark background)" value={logoDarkUrl} onChange={setLogoDarkUrl} soon />
            <ImageField label="Favicon" value={faviconUrl} onChange={setFaviconUrl} soon shape="square" />
          </div>
        </SettingsCard>

        {/* Theme presets + accent */}
        <SettingsCard title="Theme" desc="Pick a preset, then fine-tune. The brand accent applies live across the app.">
          <div className="grid gap-3 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  themePreset === p.key ? "border-primary bg-accent/50" : "hover:bg-accent/40",
                )}
              >
                <span className="h-6 w-6 flex-none rounded-full border" style={{ background: p.accent }} />
                <span>
                  <span className="block text-sm font-semibold">{p.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-4">
            <Field label="Brand accent (applied live)">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(primary) ? primary : "#8E2434"}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-9 w-11 cursor-pointer rounded border bg-transparent p-1"
                />
                <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="max-w-[150px]" />
              </div>
            </Field>
          </div>
        </SettingsCard>

        {/* Token editor */}
        <SettingsCard title="Tokens" desc="The full colour bag per mode, plus surface alpha & mesh." soon>
          <div className="mb-4">
            <Segmented
              value={tokenMode}
              onChange={setTokenMode}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {TOKEN_KEYS.map((k) => (
              <ColorRow key={k} token={k} value={tokens[k] || "#000000"} onChange={(v) => setToken(k, v)} />
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <SliderRow label="panel-alpha" value={panelAlpha} onChange={setPanelAlpha} />
            <SliderRow label="border-alpha" value={borderAlpha} onChange={setBorderAlpha} />
            <SliderRow label="mesh-opacity" value={meshOpacity} onChange={setMeshOpacity} />
          </div>
        </SettingsCard>

        {/* Typography */}
        <SettingsCard title="Typography" desc="Font roles across the platform." soon>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Display (headings)">
              <Select value={display} onChange={setDisplay} options={DISPLAY_FONTS} />
            </Field>
            <Field label="Body (UI & long-form)">
              <Select value={body} onChange={setBody} options={BODY_FONTS} />
            </Field>
            <Field label="Mono (numerics & SKUs)">
              <Select value={mono} onChange={setMono} options={MONO_FONTS} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Custom font CSS URL (optional)">
              <Input
                value={customFontUrl}
                onChange={(e) => setCustomFontUrl(e.target.value)}
                placeholder="https://fonts.googleapis.com/css2?family=…"
              />
            </Field>
          </div>
        </SettingsCard>

        {/* Live preview */}
        <SettingsCard title="Preview" desc="Reflects the live fields (name, accent, logo).">
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
            <div className="flex-1">
              <div className="font-display text-lg">{name || "Praxis LS"}</div>
              {tagline && <div className="text-xs text-muted-foreground">{tagline}</div>}
            </div>
            <button className="rounded-md px-4 py-2 text-sm font-semibold text-white" style={{ background: primary }}>
              Primary action
            </button>
          </div>
        </SettingsCard>

        {/* Layer B — per business */}
        <div className="pt-2">
          <span className="micro">Layer B</span>
          <h2 className="font-display text-xl tracking-tight">Brand Appearance — each business</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-business gradient + accent. Used by the shell chip and every document — invoices, POs, delivery notes,
            receipts, contracts.
          </p>
        </div>

        <SettingsCard title="Businesses" soon>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {businesses.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveBiz(i)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  i === activeBiz ? "border-primary bg-accent/50" : "hover:bg-accent/40",
                )}
              >
                {b.name || `Business ${i + 1}`}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setBusinesses((prev) => [
                  ...prev,
                  { id: `biz-${prev.length + 1}`, name: `Business ${prev.length + 1}`, accent: "#6F822D", gradientStart: "#35D384", gradientEnd: "#A27676" },
                ]);
                setActiveBiz(businesses.length);
              }}
              className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:bg-accent/40"
            >
              + Add business
            </button>
          </div>

          {biz && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <Input value={biz.name} onChange={(e) => updateBiz({ name: e.target.value })} />
              </Field>
              <Field label="Website">
                <Input value={biz.website || ""} onChange={(e) => updateBiz({ website: e.target.value })} placeholder="https://pixiegirlglobal.com" />
              </Field>
              <div className="sm:col-span-2 grid gap-2 sm:grid-cols-3">
                <ColorRow token="accent" value={biz.accent || "#6F822D"} onChange={(v) => updateBiz({ accent: v })} />
                <ColorRow token="grad-start" value={biz.gradientStart || "#35D384"} onChange={(v) => updateBiz({ gradientStart: v })} />
                <ColorRow token="grad-end" value={biz.gradientEnd || "#A27676"} onChange={(v) => updateBiz({ gradientEnd: v })} />
              </div>
              <div
                className="sm:col-span-2 flex items-center justify-center rounded-lg py-6 text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${biz.gradientStart || "#35D384"}, ${biz.gradientEnd || "#A27676"})` }}
              >
                {biz.name || "Business"} brand chip
              </div>
              <ImageField label="Business logo" value={biz.logoUrl || ""} onChange={(v) => updateBiz({ logoUrl: v })} soon />
            </div>
          )}
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

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/90 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
          <Button loading={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between">
        <Label>{label}</Label>
        <code className="text-[11px] text-muted-foreground">{value.toFixed(2)}</code>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[rgb(var(--brand-orange))]"
      />
    </div>
  );
}

export default AppearancePage;
