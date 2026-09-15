/**
 * Entity 360 › Public story — guide §6.8, carried out of PR 2 and built here
 * because §9.2 has nowhere to read from until somebody can fill these fields.
 *
 * The columns (13787), the API (`GET/PUT /site-settings/entities/:id/story`)
 * and the redaction tests have existed since PR 2. Only the tab was missing, so
 * the fields were reachable by curl and by nothing else.
 *
 * ── WHY THIS TAB IS BEHIND MOD-29 AND NOT MOD-01 ──────────────────────────
 *
 * The columns live on `corporate_entity`, which is master data. What they ARE
 * is website copy. `site_settings.routes.js` puts the endpoint under the
 * website's permission for that reason, and the consequence is visible here: a
 * marketing administrator who may write the homepage can write this paragraph
 * without also being handed the statutory dossier, the cap table and the
 * governance data that MOD-01 `edit` carries. The tab renders read-only for
 * somebody without it, rather than disappearing — a tab that vanishes teaches
 * an administrator that the feature does not exist.
 *
 * ── IT OPENS PRE-FILLED, AND THOSE FACTS ARE NOT EDITABLE HERE ────────────
 *
 * Q11, and §6.8: "The tenant edits prose; they do not retype facts that exist."
 * Legal name, trading name, country, registered address and incorporation date
 * are shown as a fact panel, sourced from the dossier this tab sits in. Making
 * them editable would give one company two names — the real one and the one
 * somebody typed into the website form at 5pm.
 *
 * ── AND WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────
 *
 * RCCM and NIU. They are ON the entity, three tabs away, and they are not here
 * and not in the public payload. 13787's header carries the argument: a
 * trade-register number changes no visitor's decision and is most of what
 * somebody needs to impersonate a company to its own suppliers. The panel below
 * shows what a visitor will see; if a statutory identifier appeared in it, an
 * administrator would reasonably conclude the site publishes one.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { dateDmy } from "@/lib/format";
import { AssetSlotField } from "@/features/settings/website-assets";
import * as site from "@/lib/site-settings-api";
import type { Entity } from "@/lib/masterdata-api";

/** One fact the system already holds. Read-only by design — see the header. */
function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value || tr("Not recorded")}</dd>
    </div>
  );
}

export function EntityPublicStoryTab({
  entity,
  onSaved,
}: {
  entity: Entity;
  onSaved: () => void;
}) {
  const entityId = entity.entity_id;
  const toast = useToast();
  const story = useResource<site.EntityStory>(
    () => site.getEntityStory(entityId),
    [entityId],
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{
    public_summary_fr: string;
    public_summary_en: string;
  }>({ public_summary_fr: "", public_summary_en: "" });
  const [coverage, setCoverage] = React.useState<site.EntityStory["public_coverage"]>([]);
  const [focus, setFocus] = React.useState<site.EntityStory["public_focus"]>([]);

  React.useEffect(() => {
    const d = story.data;
    if (!d) return;
    setDraft({
      public_summary_fr: d.public_summary_fr ?? "",
      public_summary_en: d.public_summary_en ?? "",
    });
    setCoverage(d.public_coverage ?? []);
    setFocus(d.public_focus ?? []);
  }, [story.data]);

  async function save(patch: Partial<site.EntityStory>) {
    setBusy(true);
    setError(null);
    try {
      await site.saveEntityStory(entityId, patch);
      story.reload();
      onSaved();
      toast.success(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (story.loading) return <LoadingRow />;
  if (story.error) {
    return (
      <ErrorState
        message={errMsg(story.error)}
        action={<Button onClick={story.reload}>{tr("Try again")}</Button>}
      />
    );
  }
  if (!story.data) return <EmptyState title={tr("No public story for this entity.")} />;

  const d = story.data;

  return (
    <div className="space-y-6">
      {error && (
        <Callout tone="bad" title={tr("Not saved")}>
          {error}
        </Callout>
      )}

      {/* THE SWITCH IS FIRST AND IT IS OFF BY DEFAULT (13787).
          An entity becomes public deliberately. Putting it at the top means an
          administrator reads "this is not on the website" before they read the
          form, rather than filling three fields and wondering why nothing
          appeared. */}
      <section className="rounded-lg border border-[var(--border)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {tr("Show this company on the public website")}
            </h3>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {tr(
                "Off by default. When it is on, the About page shows this company's trading name, country, summary, coverage and service focus — and never its registration or tax numbers.",
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {d.public_enabled ? (
              <Pill tone="ok">{tr("On the website")}</Pill>
            ) : (
              <Pill>{tr("Not published")}</Pill>
            )}
            <Checkbox
              checked={d.public_enabled}
              disabled={busy}
              onCheckedChange={(next: boolean) => save({ public_enabled: next })}
              label={tr("Published")}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-foreground">
          {tr("What the site already knows")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("From this dossier. Change them on the tabs that own them, not here.")}
        </p>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={tr("Legal name")} value={entity.legal_name} />
          <Fact label={tr("Trading name")} value={entity.trading_name} />
          <Fact label={tr("Country")} value={entity.country_code} />
          <Fact label={tr("Registered address")} value={entity.address} />
          <Fact
            label={tr("Incorporated")}
            value={entity.incorporation_date ? dateDmy(entity.incorporation_date) : null}
          />
          <Fact label={tr("Industry")} value={entity.industry} />
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-foreground">{tr("Summary")}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "A short paragraph about what this company does and where. French is the fallback everywhere on the site, so write it first.",
          )}
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {(
            [
              ["public_summary_fr", tr("Summary (FR)")],
              ["public_summary_en", tr("Summary (EN)")],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-micro uppercase tracking-[0.06em] text-muted-foreground">
                {label}
              </span>
              <textarea
                className="mt-1 min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={draft[key]}
                disabled={busy}
                onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                onBlur={(e) =>
                  e.target.value !== (d[key] ?? "") && save({ [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-foreground">{tr("Where it operates")}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "The places this company covers, in your own words. The site prints your label, never our name for the country — the two-letter code is what joins a place to the corridor network.",
          )}
        </p>
        <ul className="mt-3 space-y-2">
          {coverage.map((c, i) => (
            <li key={`${c.country_code}-${i}`} className="grid gap-2 sm:grid-cols-4">
              <Input
                aria-label={tr("Country code")}
                value={c.country_code ?? ""}
                maxLength={2}
                disabled={busy}
                onChange={(e) =>
                  setCoverage((p) =>
                    p.map((row, j) =>
                      j === i ? { ...row, country_code: e.target.value.toUpperCase() } : row,
                    ),
                  )
                }
              />
              <Input
                aria-label={tr("Label (FR)")}
                value={c.label_fr ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setCoverage((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_fr: e.target.value } : row)),
                  )
                }
              />
              <Input
                aria-label={tr("Label (EN)")}
                value={c.label_en ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setCoverage((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_en: e.target.value } : row)),
                  )
                }
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setCoverage((p) => p.filter((_, j) => j !== i))}
              >
                {tr("Remove")}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setCoverage((p) => [...p, { country_code: "", label_fr: "", label_en: "" }])
            }
          >
            {tr("Add a place")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              save({
                // Rows with no country code are dropped rather than sent: the
                // code is what joins a place to the corridor network, and a
                // blank one is a row that can never be drawn.
                public_coverage: coverage.filter((c) => (c.country_code || "").length === 2),
              })
            }
          >
            {tr("Save places")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-foreground">{tr("Service focus")}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "What this company actually handles. Naming a transport mode lets the card carry the same colour the services grid uses, instead of a second colour language.",
          )}
        </p>
        <ul className="mt-3 space-y-2">
          {focus.map((f, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-4">
              <Input
                aria-label={tr("Label (FR)")}
                value={f.label_fr ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_fr: e.target.value } : row)),
                  )
                }
              />
              <Input
                aria-label={tr("Label (EN)")}
                value={f.label_en ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_en: e.target.value } : row)),
                  )
                }
              />
              <select
                aria-label={tr("Transport mode")}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                value={f.mode ?? ""}
                disabled={busy}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) =>
                      j === i ? { ...row, mode: e.target.value || null } : row,
                    ),
                  )
                }
              >
                <option value="">{tr("No mode")}</option>
                <option value="sea">{tr("Sea")}</option>
                <option value="air">{tr("Air")}</option>
                <option value="road">{tr("Road")}</option>
                <option value="rail">{tr("Rail")}</option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setFocus((p) => p.filter((_, j) => j !== i))}
              >
                {tr("Remove")}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setFocus((p) => [...p, { label_fr: "", label_en: "", mode: null }])}
          >
            {tr("Add a service line")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              save({
                public_focus: focus.filter((f) => (f.label_fr || f.label_en || "").trim()),
              })
            }
          >
            {tr("Save service focus")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-foreground">{tr("Cover image")}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "Shown behind this company's card on the About page. It sits under a company name, so it is a photograph of this operation or it is nothing.",
          )}
        </p>
        <div className="mt-3">
          <AssetSlotField
            slot="entity-cover"
            ownerId={entityId}
            currentId={d.public_cover_vault_id}
            disabled={busy}
            onChange={() => {
              story.reload();
              onSaved();
            }}
          />
        </div>
      </section>
    </div>
  );
}
