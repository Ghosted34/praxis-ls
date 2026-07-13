/**
 * Login Screen editor (pixie spec) — everything on the signed-out door,
 * DB-driven: splash line, hero copy, backdrop, house quotes, "The Standard"
 * pillars, regional welcomes, and show/hide toggles. Content maps onto
 * branding.hero (eyebrow/headline/subline/image) + branding.login (the rest).
 *
 * Persistence is pending a backend field extension (see doc/FE_IA_HANDOFF.md §3);
 * Save sends everything for forward-compat and applies it to the branding context
 * so the landing page previews it this session.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useBranding } from "@/app/branding/branding-context";
import {
  saveBranding,
  type Branding,
  type HouseQuote,
  type Pillar,
  type RegionalWelcome,
} from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { SettingsCard, Field, TextArea, Segmented, Toggle, ImageField } from "@/components/settings/controls";

const REGIONS = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica / afar"];
const PILLAR_ICONS = ["sparkles", "heart-handshake", "gem", "globe", "shield", "star"];

const SELECT_CLASS = "h-9 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function LoginEditor() {
  const { branding, setBranding } = useBranding();
  const login = branding.login || {};

  // Splash + hero
  const [splashSubline, setSplashSubline] = React.useState(login.splashSubline || "");
  const [eyebrow, setEyebrow] = React.useState(branding.hero?.eyebrow || "");
  const [headline, setHeadline] = React.useState(branding.hero?.headline || "");
  const [subline, setSubline] = React.useState(branding.hero?.subheadline || "");
  const [buttonLabel, setButtonLabel] = React.useState(login.buttonLabel || "Enter Workspace");

  // Background
  const [background, setBackground] = React.useState<"mesh" | "image">((login.background as "mesh" | "image") || "mesh");
  const [bgImage, setBgImage] = React.useState(branding.hero?.imageUrl || "");

  // Toggles
  const [showSplash, setShowSplash] = React.useState(login.showSplash ?? true);
  const [showWebsiteLinks, setShowWebsiteLinks] = React.useState(login.showWebsiteLinks ?? true);
  const [showQuickPin, setShowQuickPin] = React.useState(login.showQuickPin ?? false);

  // Lists
  const [quotes, setQuotes] = React.useState<HouseQuote[]>(login.quotes || []);
  const [pillars, setPillars] = React.useState<Pillar[]>(login.pillars || []);
  const [regionals, setRegionals] = React.useState<RegionalWelcome[]>(
    REGIONS.map((r) => login.regionals?.find((x) => x.region === r) || { region: r, title: "", body: "" }),
  );

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    const patch: Partial<Branding> = {
      hero: {
        ...(branding.hero || {}),
        eyebrow: eyebrow || null,
        headline: headline || null,
        subheadline: subline || null,
        imageUrl: bgImage || null,
      },
      login: {
        splashSubline: splashSubline || null,
        buttonLabel: buttonLabel || null,
        background,
        showSplash,
        showWebsiteLinks,
        showQuickPin,
        quotes: quotes.filter((q) => q.text.trim()),
        pillars: pillars.filter((p) => p.title.trim()),
        regionals: regionals.filter((r) => (r.title || r.body || "").trim()),
      },
    };
    try {
      await saveBranding(patch); // forward-compat + permission check
      setBranding({ ...branding, ...patch }); // in-session preview on the landing page
      setMsg({ kind: "ok", text: "Applied for this session. Persistence is pending the backend field (see handoff)." });
    } catch (err) {
      setMsg({
        kind: "err",
        text:
          err instanceof ApiError && err.status === 403
            ? "You need the Settings (MOD-70) edit permission."
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
      <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
        ← Settings
      </Link>
      <h1 className="mt-2 font-display text-2xl tracking-tight">Login screen</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything on the signed-out door is configured here — no code, no redeploy.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <SettingsCard title="Splash screen" desc="Shown while the app loads. The logo & app name come from Appearance." soon>
          <Field label="Subline">
            <Input value={splashSubline} onChange={(e) => setSplashSubline(e.target.value)} placeholder="Loading The Home of the Perfect Pixie" />
          </Field>
        </SettingsCard>

        <SettingsCard title="Hero" soon>
          <div className="flex flex-col gap-4">
            <Field label="Eyebrow">
              <Input value={eyebrow} onChange={(e) => setEyebrow(e.target.value)} placeholder="THE PIXIE HUB" />
            </Field>
            <Field label="Headline">
              <TextArea rows={2} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="The Home of the Perfect Pixie; where beauty becomes an operation." />
            </Field>
            <Field label="Subline">
              <TextArea rows={2} value={subline} onChange={(e) => setSubline(e.target.value)} placeholder="Behind the scenes of the world's first premium pixie factory…" />
            </Field>
            <Field label="Button label">
              <Input value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Enter Workspace" />
            </Field>
          </div>
        </SettingsCard>

        <SettingsCard title="Background" desc="Brand mesh, or a full-bleed image (a dark scrim keeps text legible)." soon>
          <Segmented
            value={background}
            onChange={setBackground}
            options={[
              { value: "mesh", label: "Brand Mesh" },
              { value: "image", label: "Image" },
            ]}
          />
          {background === "image" && (
            <div className="mt-4">
              <ImageField label="Login background image" value={bgImage} onChange={setBgImage} maxBytes={2_000_000} shape="wide" hint="Large landscape image recommended." />
            </div>
          )}
        </SettingsCard>

        {/* House quotes */}
        <SettingsCard title="House quotes" desc="Rotating quotes with attribution." soon>
          <div className="flex flex-col gap-3">
            {quotes.map((q, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-3">
                <div className="flex-1 space-y-2">
                  <Input value={q.text} onChange={(e) => setQuotes((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="Luxury is care made visible." />
                  <Input value={q.attribution || ""} onChange={(e) => setQuotes((p) => p.map((x, j) => (j === i ? { ...x, attribution: e.target.value } : x)))} placeholder="Pixie Girl" className="h-8 text-xs" />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setQuotes((p) => p.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setQuotes((p) => [...p, { text: "", attribution: "" }])}>
                + Add quote
              </Button>
            </div>
          </div>
        </SettingsCard>

        {/* Pillars */}
        <SettingsCard title="The Standard (pillars)" desc="Icon + title + description." soon>
          <div className="flex flex-col gap-3">
            {pillars.map((p, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-3">
                <select
                  value={p.icon || "sparkles"}
                  onChange={(e) => setPillars((arr) => arr.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x)))}
                  className={SELECT_CLASS}
                >
                  {PILLAR_ICONS.map((ic) => (
                    <option key={ic} value={ic}>{ic}</option>
                  ))}
                </select>
                <div className="flex-1 space-y-2">
                  <Input value={p.title} onChange={(e) => setPillars((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Crafted, not assembled" />
                  <TextArea rows={2} value={p.body || ""} onChange={(e) => setPillars((arr) => arr.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} placeholder="Every piece is finished by hand to a standard we would wear ourselves." />
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPillars((arr) => arr.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setPillars((arr) => [...arr, { icon: "sparkles", title: "", body: "" }])}>
                + Add pillar
              </Button>
            </div>
          </div>
        </SettingsCard>

        {/* Regional welcomes */}
        <SettingsCard title="Regional welcomes" desc="Per-continent welcome copy shown by visitor region." soon>
          <div className="flex flex-col gap-3">
            {regionals.map((r, i) => (
              <div key={r.region} className="rounded-lg border p-3">
                <p className="micro mb-2">{r.region}</p>
                <div className="space-y-2">
                  <Input value={r.title || ""} onChange={(e) => setRegionals((arr) => arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Welcome from Africa, The Operational Heartbeat" />
                  <TextArea rows={2} value={r.body || ""} onChange={(e) => setRegionals((arr) => arr.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} placeholder="From our Lagos fulfillment center to doorsteps worldwide…" />
                </div>
              </div>
            ))}
          </div>
        </SettingsCard>

        {/* Show / hide */}
        <SettingsCard title="Show / hide" soon>
          <div className="grid gap-3 sm:grid-cols-3">
            <Toggle checked={showSplash} onChange={setShowSplash} label="Splash screen" hint="Brief logo splash on load" />
            <Toggle checked={showWebsiteLinks} onChange={setShowWebsiteLinks} label="Website links" hint="Link to brand site" />
            <Toggle checked={showQuickPin} onChange={setShowQuickPin} label="Quick PIN login" hint="2-tab PIN sign-in" />
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
        <div className={cn("mx-auto flex max-w-3xl items-center justify-end gap-3")}>
          <Button loading={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default LoginEditor;
