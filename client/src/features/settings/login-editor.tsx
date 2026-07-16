/**
 * Login Screen editor. Bound to the real backend contract
 * (`GET/PUT /branding/login`, branding.service.js): background image, headline,
 * subtext, layout (centered/split), show-logo, and an optional accent override.
 * All fields persist.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import {
  fetchLogin,
  saveLogin,
  uploadLoginBackground,
  type LoginConfig,
} from "@/lib/branding";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SettingsCard, Field, TextArea, Segmented, Toggle, ColorRow, ImageField } from "@/components/settings/controls";

export function LoginEditor() {
  const [loaded, setLoaded] = React.useState(false);
  const [backgroundUrl, setBackgroundUrl] = React.useState("");
  const [headline, setHeadline] = React.useState("");
  const [subtext, setSubtext] = React.useState("");
  const [layout, setLayout] = React.useState<"centered" | "split">("centered");
  const [showLogo, setShowLogo] = React.useState(true);
  const [accentOverride, setAccentOverride] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);

  React.useEffect(() => {
    fetchLogin()
      .then((c) => {
        setBackgroundUrl(c.backgroundUrl || "");
        setHeadline(c.headline || "");
        setSubtext(c.subtext || "");
        setLayout(c.layout || "centered");
        setShowLogo(c.showLogo ?? true);
        setAccentOverride(c.accentOverride || "");
      })
      .catch(() => {
        /* nothing configured yet — start blank */
      })
      .finally(() => setLoaded(true));
  }, []);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    const patch: Partial<LoginConfig> = {
      backgroundUrl: backgroundUrl || null,
      headline: headline || null,
      subtext: subtext || null,
      layout,
      showLogo,
      accentOverride: accentOverride || null,
    };
    try {
      await saveLogin(patch);
      setMsg({ kind: "ok", text: "Saved. The sign-in screen will show this." });
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
    <section className="mx-auto max-w-2xl animate-fade-in pb-24">
      <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
        ← Settings
      </Link>
      <h1 className="mt-2 font-display text-2xl tracking-tight">Login screen</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure the signed-out door — no code, no redeploy.
      </p>

      {!loaded ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <SettingsCard title="Copy" desc="Headline and supporting line shown on the sign-in screen.">
            <div className="flex flex-col gap-4">
              <Field label="Headline">
                <TextArea rows={2} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="The Home of the Perfect Pixie" />
              </Field>
              <Field label="Subtext">
                <TextArea rows={2} value={subtext} onChange={(e) => setSubtext(e.target.value)} placeholder="Sign in to your command center." />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard title="Layout & background" desc="How the sign-in screen is composed.">
            <div className="flex flex-col gap-4">
              <Field label="Layout">
                <Segmented
                  value={layout}
                  onChange={setLayout}
                  options={[
                    { value: "centered", label: "Centered" },
                    { value: "split", label: "Split" },
                  ]}
                />
              </Field>
              <ImageField
                label="Background image"
                value={backgroundUrl}
                onChange={setBackgroundUrl}
                shape="wide"
                hint="A dark scrim is applied automatically. Large landscape image recommended."
                upload={(d) => uploadLoginBackground(d).then((r) => r.backgroundUrl)}
              />
              <Toggle checked={showLogo} onChange={setShowLogo} label="Show logo" hint="Display the brand logo on the sign-in screen." />
              <Field label="Accent override (optional)">
                <div className="flex items-center gap-2">
                  <ColorRow token="accent" value={accentOverride || "#000000"} onChange={setAccentOverride} />
                  {accentOverride && (
                    <Button variant="ghost" size="sm" onClick={() => setAccentOverride("")}>
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
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
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/90 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-end gap-3">
          <Button loading={busy} onClick={onSave} disabled={!loaded}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default LoginEditor;
