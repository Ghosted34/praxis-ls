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
  addresses,
  onSaved,
  canEdit = false,
  headingAs = "h3",
}: {
  entity: Entity;
  addresses?: { type?: string | null; line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country_code?: string | null; po_box?: string | null; is_primary?: boolean | null }[] | null;
  onSaved: () => void;
  /** PR-01: the Public Story write gate — MOD-01 edit OR MOD-29 edit (Decision
   *  Q10). Every control below disables without it; the facts panel and the
   *  preview stay visible either way. */
  canEdit?: boolean;
  /**
   * The level this tab's own headings render at. They sit directly under the
   * entity's name with no `Section` wrapper, so they must step down from the
   * dossier title exactly like `Section` does (see `SectionHeadingLevel` in
   * entity-360.tsx): h3 beside the master–detail list's h2 name, h2 under the
   * deep-link page's h1.
   */
  headingAs?: "h2" | "h3";
}) {
  const H = headingAs;
  const entityId = entity.entity_id;
  const toast = useToast();
  const story = useResource<site.EntityStory>(
    () => site.getEntityStory(entityId),
    [entityId],
  );
  // The catalogue behind the focus picker (Decision Q8). Fetched beside the
  // story rather than embedded in it, so a taxonomy edit does not rewrite the
  // story row, and so the picker is one source for however the focus list is
  // long.
  const catalogue = useResource<site.ServiceFocusEntry[]>(
    () => site.listServiceFocus(),
    [],
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
            <H className="text-sm font-medium text-foreground">
              {tr("Show this company on the public website")}
            </H>
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
              disabled={busy || !canEdit}
              onCheckedChange={(next: boolean) => save({ public_enabled: next })}
              label={tr("Published")}
            />
          </div>
        </div>
      </section>

      {/* Decision Q1: the switch is not the only gate. The lifecycle ladder is
          authoritative — a DRAFT, PENDING_REVIEW, SUSPENDED, DEACTIVATED or
          ARCHIVED company is NOT on the website however brightly the switch
          glows, and its cover URLs 404 too. Saying so here, beside the switch
          the operator just flipped, is the difference between a correction and
          a support ticket that says "the toggle is on but the site ignores
          me". */}
      {d.public_enabled && d.registration_status !== "ACTIVE" ? (
        <Callout tone="warn" title={tr("Not on the website")}>
          {tr(
            "Publishing is on, but this company's lifecycle status is not ACTIVE, so the public website excludes it — and serves 404s for its cover. Set the status back to ACTIVE in Master data to publish it.",
          )}
        </Callout>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] p-4">
        <H className="text-sm font-medium text-foreground">
          {tr("What the site already knows")}
        </H>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr("From this dossier. Change them on the tabs that own them, not here.")}
        </p>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={tr("Legal name")} value={entity.legal_name} />
          <Fact label={tr("Trading name")} value={entity.trading_name} />
          <Fact label={tr("Country")} value={entity.country_code} />
          <Fact
            label={tr("Registered address")}
            value={(() => {
              if (entity.address) return entity.address;
              const list = addresses || [];
              const reg = list.find((a) => a.type === "REGISTERED") || list.find((a) => a.is_primary) || list[0] || null;
              if (!reg) return null;
              const parts = [reg.line1, reg.line2, reg.po_box ? `PO Box ${reg.po_box}` : null, [reg.postal_code, reg.city].filter(Boolean).join(" "), reg.region, reg.country_code].filter(Boolean);
              return parts.join(", ") || null;
            })()}
          />
          <Fact
            label={tr("Incorporated")}
            value={entity.incorporation_date ? dateDmy(entity.incorporation_date) : null}
          />
          <Fact label={tr("Industry")} value={entity.industry} />
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <H className="text-sm font-medium text-foreground">{tr("Summary")}</H>
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
                disabled={busy || !canEdit}
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
        <H className="text-sm font-medium text-foreground">{tr("Where it operates")}</H>
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
                disabled={busy || !canEdit}
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
                disabled={busy || !canEdit}
                onChange={(e) =>
                  setCoverage((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_fr: e.target.value } : row)),
                  )
                }
              />
              <Input
                aria-label={tr("Label (EN)")}
                value={c.label_en ?? ""}
                disabled={busy || !canEdit}
                onChange={(e) =>
                  setCoverage((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_en: e.target.value } : row)),
                  )
                }
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !canEdit}
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
            disabled={busy || !canEdit}
            onClick={() =>
              setCoverage((p) => [...p, { country_code: "", label_fr: "", label_en: "" }])
            }
          >
            {tr("Add a place")}
          </Button>
          <Button
            size="sm"
            disabled={busy || !canEdit}
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
        <H className="text-sm font-medium text-foreground">{tr("Service focus")}</H>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "What this company actually handles. Classify each line against a service type from your catalogue — the transport mode and the card's colour come from it, in every language. Your labels are optional wording on top of the classification.",
          )}
        </p>
        {catalogue.error ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {tr("The service catalogue could not be loaded.")}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {focus.map((f, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-4">
              <Input
                aria-label={tr("Label (FR)")}
                value={f.label_fr ?? ""}
                disabled={busy || !canEdit}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_fr: e.target.value } : row)),
                  )
                }
              />
              <Input
                aria-label={tr("Label (EN)")}
                value={f.label_en ?? ""}
                disabled={busy || !canEdit}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) => (j === i ? { ...row, label_en: e.target.value } : row)),
                  )
                }
              />
              {/* The PICKER, not a free mode: Decision Q8. The key is the
                  tenant's own taxonomy; the mode shown beside it is DERIVED
                  server-side from that key and comes back read-only — the
                  operator classifies, the catalogue decides the colour. */}
              <select
                aria-label={tr("Service type")}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                value={f.service_type_key ?? ""}
                disabled={busy || !canEdit}
                onChange={(e) =>
                  setFocus((p) =>
                    p.map((row, j) =>
                      j === i ? { ...row, service_type_key: e.target.value || null } : row,
                    ),
                  )
                }
              >
                <option value="">{tr("No service type")}</option>
                {(catalogue.data || []).map((st) => (
                  <option key={st.key} value={st.key}>
                    {`${st.label.fr || st.label.en || st.key}${st.mode ? ` · ${st.mode}` : ""}`}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <span className="text-micro uppercase tracking-[0.06em] text-muted-foreground">
                  {f.mode ?? tr("No mode")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !canEdit}
                  onClick={() => setFocus((p) => p.filter((_, j) => j !== i))}
                >
                  {tr("Remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canEdit}
            onClick={() =>
              setFocus((p) => [...p, { label_fr: "", label_en: "", service_type_key: null }])
            }
          >
            {tr("Add a service line")}
          </Button>
          <Button
            size="sm"
            disabled={busy || !canEdit}
            onClick={() =>
              save({
                // A line needs a classification or a label to be worth
                // publishing: the key carries the card's colour, the label
                // carries its words, and a row with neither renders nothing
                // anywhere.
                public_focus: focus.filter(
                  (f) =>
                    (f.label_fr || f.label_en || "").trim() ||
                    (f.service_type_key || "").trim(),
                ),
              })
            }
          >
            {tr("Save service focus")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <H className="text-sm font-medium text-foreground">{tr("Cover image")}</H>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {tr(
            "Shown behind this company's card on the About page. It sits under a company name, so it is a photograph of this operation or it is nothing.",
          )}
        </p>
        {/*
         * PR-07 (CE-25): the durable half of upload failure. A failed
         * replacement leaves the previous cover serving — the pointer never
         * moved — and until this banner existed the only trace of the failure
         * was a toast that died with the modal. `cover_attachment` comes from
         * the attachment outbox and disappears the moment the last attempt
         * links or is reconciled, so the banner cannot outlive its problem.
         */}
        {d.cover_attachment && (
          <Callout tone="warn" title={tr("The last cover upload did not take")}>
            {d.cover_attachment.state === "FAILED" ? (
              <>
                {tr("It failed on")}{" "}
                {d.cover_attachment.updated_at
                  ? dateDmy(d.cover_attachment.updated_at)
                  : ""}{" "}
                — {d.cover_attachment.last_error || tr("the server did not say why")}.{" "}
                {d.cover_attachment.vault_doc_id
                  ? tr(
                      "The file reached storage but was never published, so the cover shown above is still the previous one. Try again — the stored copy is cleaned up automatically.",
                    )
                  : tr(
                      "No file was stored. The cover shown above is unchanged. Try again.",
                    )}
              </>
            ) : (
              tr(
                "An upload was interrupted before it finished. If you just uploaded, give it a moment and reload; otherwise try again — the previous cover is still the one on the site.",
              )
            )}
          </Callout>
        )}
        <div className="mt-3">
          <AssetSlotField
            slot="entity-cover"
            ownerId={entityId}
            currentId={d.public_cover_vault_id}
            disabled={busy || !canEdit}
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
