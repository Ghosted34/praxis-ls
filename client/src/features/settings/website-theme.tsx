/**
 * Settings › Website › Theme — the tenant's colours and faces for their public
 * site.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM Settings › Appearance ──────────────────
 *
 * Appearance themes the ERP: the app the tenant's own staff use all day. This
 * themes the site strangers judge them by, and the two are deliberately not the
 * same row — a tenant may want a restrained workspace and a confident front
 * door, and a product that forces one palette on both surfaces has decided that
 * for them.
 *
 * ── THE TENANT PICKS THREE COLOURS AND THE ENGINE DOES THE REST ───────────
 *
 * `packages/shared/design/palette.js` turns up to three brand colours into a
 * complete two-theme token set — surfaces tinted toward the brand hue, an
 * accent stepped down until it clears 4.5:1 as text, a label on the accent fill
 * that is carbon or white depending on which one actually passes, transport
 * colours harmonised into the same colour world.
 *
 * That derivation runs on the SERVER, and this screen previews it by reading
 * the same endpoint the public site paints from. It deliberately does no colour
 * maths of its own: a preview that computed its own tokens would eventually
 * disagree with the site, and the tenant would find out from a screenshot
 * somebody sent them.
 *
 * ── WHY THE CORRECTIONS ARE SPELLED OUT IN WORDS ──────────────────────────
 *
 * The single most common support conversation about white-label theming is "I
 * set my brand orange and the text is a different orange". It is not a bug — it
 * is the accent measuring 3.13:1 on white and failing AA — but nobody can tell
 * that from looking. So the screen says it: the colour, the ratio it measured,
 * the colour it became, and the ratio that clears. A tenant who understands the
 * correction stops fighting it.
 *
 * ── AND WHY THE FONT LIST IS SHORTER THAN THE ERP'S ───────────────────────
 *
 * `client/src/lib/fonts.ts` offers seventeen families, each lazily loaded.
 * `public-web` self-hosts four, subset, because it has a first-paint budget the
 * ERP does not. Offering all seventeen here would let a tenant choose a face
 * their public site cannot render — a stack naming a family no `@font-face`
 * declares, falling silently through to the generic, invisible to everyone who
 * happens to have it installed. So this picker offers what the site can
 * actually paint, and `packages/shared/design/site-fonts.js` is the one list;
 * a test pins it against the stylesheet in both directions.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field, Segmented, ColorRow } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { auditTheme, type ContrastRow } from "@praxis/shared/design/palette";
// The SAME schema the API validates with. Not belt-and-braces: without it the
// only feedback on a malformed colour is a 422 after Save, which is the worst
// moment to learn a field was wrong.
import { siteSettings } from "@praxis/shared";
import { SITE_FONT_ROLES } from "@praxis/shared/design/site-fonts";
import { WebsiteNav } from "./website-nav";

const ROLE_LABEL: Record<string, string> = {
  display: "Display",
  body: "Body",
  mono: "Figures",
};

/** Font ids are stable; their human names are not worth a second registry. */
const FONT_NAME: Record<string, string> = {
  archivo: "Archivo",
  "ibm-plex-sans": "IBM Plex Sans",
  inter: "Inter",
  "jetbrains-mono": "JetBrains Mono",
};

/**
 * A miniature of the real thing.
 *
 * A swatch grid is the obvious preview and the wrong one: nobody judges a
 * palette on squares. What a tenant needs to see is whether their orange works
 * as a heading, as a button, and as a quiet line of secondary text on the
 * surface those actually sit on — so the preview is a composition, painted
 * entirely from the derived tokens with no colour of its own.
 */
function Preview({
  tokens,
  fonts,
  label,
}: {
  tokens: Record<string, string>;
  fonts: { display: string; body: string };
  label: string;
}) {
  const style = {
    background: tokens["--background"],
    color: tokens["--foreground"],
    borderColor: tokens["--border"],
  } as React.CSSProperties;

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="overflow-hidden rounded-lg border" style={style}>
        <div className="p-4" style={{ background: tokens["--card"] }}>
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: tokens["--primary-ink"] }}
          >
            {tr("Shipment visibility")}
          </p>
          <p
            className="mt-1 text-lg font-semibold leading-tight"
            style={{ fontFamily: `"${FONT_NAME[fonts.display] ?? ""}", sans-serif` }}
          >
            {tr("Freight that moves your business")}
          </p>
          <p className="mt-1.5 text-xs" style={{ color: tokens["--muted-foreground"] }}>
            {tr("Sea, air and hinterland logistics across the region.")}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span
              className="inline-flex h-7 items-center rounded px-3 text-xs font-semibold"
              style={{ background: tokens["--primary"], color: tokens["--primary-foreground"] }}
            >
              {tr("Request a quote")}
            </span>
            <span
              className="inline-flex h-7 items-center rounded border px-3 text-xs font-semibold"
              style={{ borderColor: tokens["--input"], color: tokens["--foreground"] }}
            >
              {tr("Track")}
            </span>
          </div>
          {/* The four transport colours, harmonised into this palette. They are
              identity, never a control — which is why they are drawn as bars
              and not as buttons. */}
          <div className="mt-3 flex gap-1">
            {(["sea", "air", "road", "rail"] as const).map((m) => (
              <span
                key={m}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: `rgb(${tokens[`--mode-${m}`]})` }}
                title={m}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every promised pair, measured, with the ones that fail called out. */
function ContrastReport({ tokens, label }: { tokens: Record<string, string>; label: string }) {
  const rows = React.useMemo(() => auditTheme(tokens), [tokens]);
  const failing = rows.filter((r: ContrastRow) => !r.ok);
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {failing.length === 0 ? (
        <p className="text-xs text-ok">
          {rows.length} {tr("text and interface pairs clear WCAG AA.")}
        </p>
      ) : (
        <ul className="space-y-1 text-xs text-bad">
          {failing.map((r: ContrastRow) => (
            <li key={`${r.fg}${r.bg}`}>
              {r.fg} {tr("on")} {r.bg} — {r.ratio}:1 ({tr("needs")} {r.required}:1)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WebsiteThemePage() {
  const [form, setForm] = React.useState<api.SiteTheme | null>(null);
  const [preview, setPreview] = React.useState<api.ThemePreview | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([api.getTheme(), api.getThemePreview()])
      .then(([theme, p]) => {
        setForm(theme);
        setPreview(p);
        setLoadError(null);
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  const set = <K extends keyof api.SiteTheme>(k: K, v: api.SiteTheme[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };

  async function save() {
    if (!form) return;
    // Checked here first so the message names the FIELD. The server checks the
    // same object with the same schema; this is not a second opinion, it is the
    // same one, earlier.
    const parsed = siteSettings.theme.safeParse(form);
    if (!parsed.success) {
      const first = Object.entries(parsed.error.flatten().fieldErrors)[0];
      setSaveError(first ? `${first[0]}: ${(first[1] as string[])[0]}` : tr("Check the values above."));
      setSaved(false);
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveTheme(form);
      // Re-read the preview rather than deriving locally: the point of this
      // screen is that what it shows is what the site will paint, and the only
      // way to keep that true is to ask the same endpoint the site asks.
      setPreview(await api.getThemePreview());
      setSaved(true);
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        action={<Button onClick={load}>{tr("Try again")}</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Website theme")}
        description={tr(
          "The colours and faces of your public site. Pick up to three brand colours; everything else is derived so it stays readable.",
        )}
      />
      <WebsiteNav />

      {!form || !preview ? null : (
        <div className="space-y-5">
          <SettingsCard
            title={tr("Brand colours")}
            desc={tr(
              "Your accent is the only thing on the site that looks pressable. The second and third are used for structure and for the transport lines.",
            )}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={tr("Accent")}>
                <ColorRow
                  token="--primary"
                  value={form.primary_hex}
                  onChange={(v) => set("primary_hex", v)}
                />
              </Field>
              <Field label={tr("Secondary")}>
                <ColorRow
                  token="--secondary"
                  value={form.secondary_hex ?? ""}
                  onChange={(v) => set("secondary_hex", v)}
                />
              </Field>
              <Field label={tr("Third")}>
                <ColorRow
                  token="--tertiary"
                  value={form.tertiary_hex ?? ""}
                  onChange={(v) => set("tertiary_hex", v)}
                />
              </Field>
            </div>
            {(preview.derived.secondary || preview.derived.tertiary) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {tr(
                  "You have given one colour, so the others are derived from it. Set them yourself at any time.",
                )}
              </p>
            )}
          </SettingsCard>

          {preview.corrections.length > 0 && (
            <Callout tone="info" title={tr("What we changed, and why")}>
              <ul className="space-y-1 text-sm">
                {preview.corrections.map((c, i) => (
                  <li key={i}>
                    {c.reason === "accent-as-text" ? (
                      <>
                        <strong>{c.theme === "light" ? tr("Light theme") : tr("Dark theme")}:</strong>{" "}
                        {tr("your accent")} <code>{c.from}</code> {tr("measures")} {c.fromRatio}:1{" "}
                        {tr("as text and fails the 4.5:1 readability floor, so text uses")}{" "}
                        <code>{c.to}</code> {tr("at")} {c.toRatio}:1.{" "}
                        {tr("Fills still use your exact colour.")}
                      </>
                    ) : (
                      <>
                        <strong>{c.theme === "light" ? tr("Light theme") : tr("Dark theme")}:</strong>{" "}
                        {tr("neither black nor white was readable on")} <code>{c.from}</code>,{" "}
                        {tr("so the fill was deepened to")} <code>{c.to}</code>{" "}
                        {tr("to keep its label legible.")}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <SettingsCard
            title={tr("Type")}
            desc={tr("Only faces your public site self-hosts, so what you pick is what every visitor renders.")}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {(["display", "body", "mono"] as const).map((role) => (
                <Field key={role} label={tr(ROLE_LABEL[role])}>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                    value={form[`font_${role}` as const] as string}
                    onChange={(e) => set(`font_${role}` as never, e.target.value as never)}
                    aria-label={tr(ROLE_LABEL[role])}
                  >
                    {SITE_FONT_ROLES[role].map((id: string) => (
                      <option key={id} value={id}>
                        {FONT_NAME[id] ?? id}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard
            title={tr("Shape and first impression")}
            desc={tr("A visitor's own light/dark choice always wins after their first visit.")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={tr("Corner radius")}>
                <Input
                  type="number"
                  min={0}
                  max={32}
                  value={form.radius_px}
                  onChange={(e) => set("radius_px", Number(e.target.value))}
                />
              </Field>
              <Field label={tr("Theme on first visit")}>
                <Segmented
                  value={form.default_mode}
                  onChange={(v) => set("default_mode", v)}
                  options={[
                    { value: "light", label: tr("Light") },
                    { value: "dark", label: tr("Dark") },
                  ]}
                />
              </Field>
            </div>
          </SettingsCard>

          <SettingsCard
            title={tr("Preview")}
            desc={tr("Both themes, painted from the same values your site will use.")}
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              <Preview tokens={preview.light} fonts={preview.fonts} label={tr("Light")} />
              <Preview tokens={preview.dark} fonts={preview.fonts} label={tr("Dark")} />
            </div>
            <div className="mt-4 flex flex-col gap-4 border-t border-[var(--border)] pt-4 sm:flex-row">
              <ContrastReport tokens={preview.light} label={tr("Readability, light")} />
              <ContrastReport tokens={preview.dark} label={tr("Readability, dark")} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {tr("The preview updates when you save.")}
            </p>
          </SettingsCard>

          {saveError && <Callout tone="bad" title={tr("Not saved")}>{saveError}</Callout>}
          {saved && !saveError && (
            <Callout tone="ok" title={tr("Saved")}>
              {tr("Your site picks this up on the next page load.")}
            </Callout>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              {tr("Discard changes")}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? tr("Saving…") : tr("Save theme")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
