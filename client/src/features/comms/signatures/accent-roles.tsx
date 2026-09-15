/**
 * CARD COLOURS — which of the tenant's brand colours paints which part of the
 * signature card.
 *
 * WHAT THIS IS NOT. It is not a colour picker, and the distinction is the whole
 * reason it is allowed to exist next to a rule that says the card's colours are
 * not editable outside Appearance. Nothing here sets a colour: every option is a
 * brand colour the tenant has already chosen, and what gets stored is its NAME.
 * Change that colour in Appearance afterwards and the card follows, because the
 * card was never told a hex.
 *
 * WHY IT WAS NEEDED. The card maps `ink` to the brand's deep accent, `glow` to
 * its glow and `warm` to its primary (signature.palette.js explains why that
 * mapping and not the obvious one). The mapping is right for a brand whose deep
 * accent is its dark colour — and a tenant whose deep accent is their ORANGE
 * gets an orange name with no way to change it short of editing the brand
 * itself, which would move that colour everywhere else in the product too. The
 * gap was never a missing colour, it was a missing mapping.
 *
 * EVERYONE ON THE TEMPLATE, NOT JUST YOU. The mapping lives on
 * `signature_template.layout`, so it is MOD-70 and it moves every card rendered
 * from that template at once. The footer says so in words rather than leaving it
 * to be discovered from someone else's mail.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { RadioGroup } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";

/**
 * The brand colours, in words.
 *
 * Client-side rather than on the wire so `tr()` can reach them — the server
 * sends keys and hexes, which are not language. The keys are Appearance's own
 * field names; the labels are what Appearance calls them on screen, so a person
 * moving between the two screens is choosing from the same list under the same
 * names.
 */
const BRAND_LABEL: Record<api.BrandColorKey, string> = {
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  accentDeep: "Accent deep",
  accentGlow: "Accent glow",
};

/**
 * What each role paints, for a person who has never read the renderer.
 *
 * The server also sends a `paints` string, and this is not a duplicate of it:
 * that one is the renderer's own description, written beside the CSS, and it is
 * a fallback for a role this screen has not been taught yet. These are the
 * headings, and they are here because they are translated copy.
 */
const ROLE_COPY: Record<
  api.SignatureRole["role"],
  { title: string; paints: string }
> = {
  ink: {
    title: "Name and headline",
    paints: "The person's name, the website, the motto and the divider rule.",
  },
  glow: {
    title: "Edges and background",
    paints: "The card's border, its background tint and the middle of the top bar.",
  },
  warm: {
    title: "Accent marks",
    paints: "The dash beside the job title, and the phone and website icons.",
  },
};

/** What is chosen on screen. Only ever a brand key — clearing a role back to
 *  the default is a save of `null`, not a draft state. */
type Draft = Partial<Record<api.SignatureRole["role"], api.BrandColorKey>>;

/** The write shape: `null` hands a role back to the default mapping. */
type Roles = Partial<Record<api.SignatureRole["role"], api.BrandColorKey | null>>;

export function AccentRoles({
  /** Re-fetch the preview next door: the card is server-rendered, so a saved
   *  colour only appears once it has been asked for again. */
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const toast = useToast();
  const { data, error, reload } = useResource(() => api.getSignaturePalette(), []);
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  /**
   * What is on screen but not yet saved.
   *
   * Kept separate from `data` rather than written into it so the Save button has
   * something to compare against, and so a failed save leaves the person's
   * choice in front of them instead of snapping back to the server's.
   */
  const [draft, setDraft] = React.useState<Draft>({});
  React.useEffect(() => setDraft({}), [data]);

  const roles = React.useMemo(
    () => (data && !Array.isArray(data) ? data.roles : []) || [],
    [data],
  );
  const brand = React.useMemo(
    () => (data && !Array.isArray(data) ? data.brand : []) || [],
    [data],
  );
  const template = data && !Array.isArray(data) ? data.template : null;

  const sourceOf = (r: api.SignatureRole) => draft[r.role] ?? r.source;
  const dirty = roles.some((r) => draft[r.role] && draft[r.role] !== r.source);
  const repointed = roles.filter((r) => r.is_repointed);

  async function save(next: Roles) {
    if (!template) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.saveSignaturePalette(template.signature_template_id, next);
      toast.success(tr("Card colours updated"));
      reload();
      onSaved?.();
    } catch (err) {
      reportActionError(err);
      setSaveError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  /** Hand every role back to the default mapping. `null` is the reset — there is
   *  no separate endpoint, because "the default" is a value like any other. */
  const resetAll = () => save({ ink: null, glow: null, warm: null });

  // The hosts only mount this for a caller who can administer mail, so an error
  // here is a real one — a 403 would mean the capability answer and the grant
  // disagree, which is worth seeing rather than hiding.
  if (error) return <ErrorState message={error} />;
  if (data === null) return <SkeletonTable />;
  if (!template) return null;

  const options = brand.map((b) => ({
    value: b.key,
    label: (
      <span className="whitespace-nowrap">
        {tr(BRAND_LABEL[b.key] ?? b.key)}
        {!b.is_set && (
          <span className="text-muted-foreground"> · {tr("default")}</span>
        )}
      </span>
    ),
    swatch: b.hex,
  }));

  return (
    <div className="lux-card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">{tr("Card colours")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr(
            "Choose which of your brand colours paints each part of the card. The colours themselves stay in Appearance, so changing one there moves it everywhere at once.",
          )}{" "}
          <Link className="underline" to="/settings/appearance">
            {tr("Open Appearance")}
          </Link>
        </p>
      </div>

      {saveError && <ErrorState message={saveError} />}

      {template.kind !== "card" && (
        <Callout tone="info" title={tr("This template is not the card")}>
          {tr(
            "“{name}” renders a plain table, which uses none of these. Switch to the signature card to see them.",
          ).replace("{name}", template.name)}
        </Callout>
      )}

      <div className="space-y-4">
        {roles.map((r) => {
          const copy = ROLE_COPY[r.role];
          const chosen = sourceOf(r);
          const swatch = brand.find((b) => b.key === chosen);
          return (
            <div key={r.role} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-medium">
                  {tr(copy ? copy.title : r.role)}
                </h3>
                {r.is_repointed && (
                  <Pill tone="blue">{tr("changed")}</Pill>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {tr(copy ? copy.paints : r.paints)}
              </p>
              <RadioGroup
                layout="inline"
                aria-label={tr(copy ? copy.title : r.role)}
                value={chosen}
                disabled={busy}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, [r.role]: v as api.BrandColorKey }))
                }
                options={options}
              />
              {/* The chosen colour in words and in hex. Without it the row's
                  state rests on a ring around a swatch, which is not something
                  a screen reader or a printout carries. */}
              <p className="text-xs text-muted-foreground">
                {tr("Now:")}{" "}
                <span className="font-medium text-foreground">
                  {tr(BRAND_LABEL[chosen] ?? chosen)}
                </span>{" "}
                <span className="font-mono">{swatch ? swatch.hex : ""}</span>
                {chosen === r.default_source && ` · ${tr("the default")}`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <p className="min-w-[200px] flex-1 text-xs text-muted-foreground">
          {tr(
            "Applies to everyone whose signature uses “{name}”.",
          ).replace("{name}", template.name)}
        </p>
        {repointed.length > 0 && (
          <Button size="sm" variant="outline" disabled={busy} onClick={resetAll}>
            {tr("Back to brand defaults")}
          </Button>
        )}
        <Button size="sm" loading={busy} disabled={busy || !dirty} onClick={() => save(draft)}>
          {tr("Save colours")}
        </Button>
      </div>
    </div>
  );
}

export default AccentRoles;
