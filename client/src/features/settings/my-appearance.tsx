/**
 * My appearance — the personal layer over the tenant's typography.
 *
 * Self-service: no permission needed, and the endpoints behind it
 * (`/me/preferences/appearance`) are always scoped to the caller, so nothing on
 * this screen can affect anyone else. Colour, logo and favicon are absent on
 * purpose — those are the company's identity and stay under Settings →
 * Appearance, behind the Settings-edit grant.
 *
 * Every field defaults to "Use the workspace default", and choosing that clears
 * the row rather than storing a copy of the tenant's current value. The
 * difference matters: an inherited field keeps tracking the tenant when the
 * brand changes, a copied one silently freezes at whatever it was the day the
 * user opened this page.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useBranding } from "@/app/branding/branding-context";
import {
  saveUserAppearance,
  resetUserAppearance,
  type UserAppearance,
} from "@/lib/preferences";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { SettingsCard, Field } from "@/components/settings/controls";
import { FontPicker } from "@/components/settings/font-picker";
import { fontByValue } from "@/lib/fonts";
import { RailCard } from "./rail-card";
import { TowerCard } from "./tower-card";

/** What the tenant set for a slot, named for humans. */
function inheritedLabel(value: string | null | undefined) {
  if (!value) return "the app default (Inter)";
  return fontByValue(value)?.name ?? "a custom font";
}

export function MyAppearancePage() {
  const { branding, userAppearance, setUserAppearance } = useBranding();

  const [draft, setDraft] = React.useState<UserAppearance>(userAppearance);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  // The context resolves asynchronously (UserAppearanceSync fetches after auth),
  // so this screen can mount before the user's saved values arrive. Re-seed when
  // they land — but only while the form is pristine, so an in-flight edit is
  // never overwritten by a late response.
  const dirty = React.useRef(false);
  React.useEffect(() => {
    if (!dirty.current) setDraft(userAppearance);
  }, [userAppearance]);

  const set = (k: keyof UserAppearance, v: string) => {
    dirty.current = true;
    // "" is how the picker reports "no choice"; it must persist as null, which
    // deletes the row and restores inheritance.
    setDraft((d) => ({ ...d, [k]: v || null }));
  };

  const hasOverrides = Object.values(draft).some(Boolean);

  async function onSave() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await saveUserAppearance(draft);
      setUserAppearance(saved); // repaints the whole app immediately
      dirty.current = false;
      setDraft(saved);
      setMsg({
        kind: "ok",
        text: "Saved. Your fonts are applied across the app.",
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text:
          err instanceof ApiError ? err.message : "Couldn't save. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setMsg(null);
    try {
      const saved = await resetUserAppearance();
      setUserAppearance(saved);
      dirty.current = false;
      setDraft(saved);
      setMsg({
        kind: "ok",
        text: "Cleared. You're back on the workspace fonts.",
      });
    } catch (err) {
      setMsg({
        kind: "err",
        text:
          err instanceof ApiError ? err.message : "Couldn't reset. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  // What each slot will actually render once saved — the user's pick, or the
  // tenant's if they have not made one.
  const effective = {
    display: draft.fontDisplay || branding.fontDisplay || "",
    body: draft.fontBody || branding.fontBody || "",
    mono: draft.fontMono || branding.fontMono || "",
  };

  return (
    /*
     * WIDE PAGE, NARROW MEASURE. This screen used `pageShell.reading`, which
     * caps the whole PAGE at reading width — so on a desktop it sat as a narrow
     * column with several hundred pixels of dead space beside it, while every
     * data screen in the app fills the viewport. Inside a desktop shell that
     * reads as a web page embedded in an application rather than as part of it.
     *
     * The fix is not to stretch the form: a 1600px-wide select is worse than a
     * narrow one, and capping measure was the right instinct. It is that the
     * page should be wide and its CONTENT should be a composition — controls at
     * a readable width on the left, the live preview holding the right. The
     * preview was already here and stacked underneath, where it competed with
     * the controls for vertical space and left the horizontal space empty.
     * Same treatment as the App & PWA editor, for the same reason.
     */
    <section className={pageShell.wide}>
      <PageHeader
        title="My appearance"
        description="Your own typography. Applies to you across every device you sign in on, and to nobody else."
      />

      <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SettingsCard
            title="Typography"
            desc="Fifteen self-hosted families. Leave a field on the workspace default to keep following your organisation's brand."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display font">
                <FontPicker
                  slot="display"
                  aria-label="Display font"
                  value={draft.fontDisplay || ""}
                  onChange={(v) => set("fontDisplay", v)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Workspace default: {inheritedLabel(branding.fontDisplay)}
                </p>
              </Field>
              <Field label="Body font">
                <FontPicker
                  slot="body"
                  aria-label="Body font"
                  value={draft.fontBody || ""}
                  onChange={(v) => set("fontBody", v)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Workspace default: {inheritedLabel(branding.fontBody)}
                </p>
              </Field>
              <Field label="Mono font">
                <FontPicker
                  slot="mono"
                  aria-label="Mono font"
                  value={draft.fontMono || ""}
                  onChange={(v) => set("fontMono", v)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Workspace default: {inheritedLabel(branding.fontMono)}
                </p>
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

          {/* Same column as Typography, and for the same reason: both are personal
            display preferences that persist through /me/preferences, so they
            belong together rather than in the tenant's brand editor. It saves on
            change rather than on this page's Save button — a pinned shortcut is
            a single toggle, and a toggle that needs confirming is a toggle that
            gets left half-set. */}
          <RailCard />

          {/* The Control Tower's Applications grid, edited. Directly below the
            rail picker because the two are the same concept applied to two
            surfaces — rail down the left, tower on the home screen. Both save
            immediately for the same reason. */}
          <TowerCard />
        </div>

        {/* The preview column. Sticky, so it stays in view while the pickers are
            worked — the whole point of choosing a typeface is watching real
            copy re-set in it. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SettingsCard
            title="Preview"
            desc="How the app will read for you once saved."
          >
            <div className="space-y-2 rounded-lg border p-4">
              <div
                className="text-lg font-semibold"
                style={{
                  fontFamily: effective.display || "var(--font-display)",
                }}
              >
                Consignment SLAS-2026-0142 cleared
              </div>
              <p
                className="text-sm opacity-80"
                style={{ fontFamily: effective.body || "var(--font-body)" }}
              >
                Body text as you will read it all day. The quick brown fox
                clears customs at Douala and continues to Yaoundé — 12 pallets,
                4,800 kg, delivered against a signed waybill.
              </p>
              <code
                className="block text-xs opacity-80"
                style={{ fontFamily: effective.mono || "var(--font-mono)" }}
              >
                INV-2026-0142 · 12,000,000 XAF · 0O1lI
              </code>
            </div>
          </SettingsCard>

          <div className="mt-5 flex items-center justify-end gap-3">
            {/* Only offered when there is something to clear — a reset button that
              does nothing is a button that teaches people not to trust buttons. */}
            {hasOverrides && (
              <Button variant="ghost" onClick={onReset} disabled={busy}>
                Reset to workspace fonts
              </Button>
            )}
            <Button loading={busy} onClick={onSave}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default MyAppearancePage;
