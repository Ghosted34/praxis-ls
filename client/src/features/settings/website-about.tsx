/**
 * Settings › Website › About — the group's story and its leadership.
 *
 * ── WHY THE GROUP STORY IS EDITED HERE AND AN ENTITY'S IS NOT ─────────────
 *
 * Two tiers, and which fact belongs where is the decision that keeps this
 * correct as a group grows:
 *
 *   here                 the COMPANY's story — mission, vision, principles,
 *                        ESG, founding, headquarters, timeline
 *   the entity dossier   what ONE legal company does: where it operates, which
 *                        corridors, which services
 *
 * A group's mission does not belong to a subsidiary, and a subsidiary's
 * coverage does not belong to the group. Putting both here would be one blob of
 * prose no entity page could draw from; putting both on the entity would mean
 * retyping the mission once per company.
 *
 * ── LEADERSHIP IS ONE TABLE WITH TWO TIERS ─────────────────────────────────
 *
 * `entity_id IS NULL` is group leadership. This screen edits that tier; an
 * entity's own people are edited in its dossier. One renderer, one set of
 * rules, and a nullable column doing the work two tables would have done badly.
 *
 * ── PORTRAITS ──────────────────────────────────────────────────────────────
 *
 * N12 forbids stock photographs of people and the experience guide extends that
 * to generated ones — a portrait is a real photograph of a real person or it is
 * nothing. That is not a note here any more: `AssetSlotField` offers `owned`
 * and `licensed` and does not offer `generated`, the API refuses it for this
 * slot with the reason, and 13789's `ck_vault_generated_is_atmosphere_only`
 * refuses it again at the row.
 *
 * A leader with no portrait still renders as a name, a role and a biography.
 * That is the correct empty state, not a broken card — see the About page's own
 * `LeaderCard`, which draws a monogram plate rather than a grey silhouette.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { WebsiteNav } from "./website-nav";
import { AssetSlotField } from "./website-assets";

/** A bilingual pair. FR is the fallback everywhere in this product, so the
 *  French field leads — a half-translated page falls back to it rather than to
 *  a blank, and putting it second invites it to be the one left empty. */
function Bilingual({
  label,
  fr,
  en,
  rows = 3,
  onChange,
}: {
  label: string;
  fr: string;
  en: string;
  rows?: number;
  onChange: (next: { fr: string; en: string }) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={`${label} (FR)`}>
        <textarea
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          rows={rows}
          value={fr}
          onChange={(e) => onChange({ fr: e.target.value, en })}
        />
      </Field>
      <Field label={`${label} (EN)`}>
        <textarea
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          rows={rows}
          value={en}
          onChange={(e) => onChange({ fr, en: e.target.value })}
        />
      </Field>
    </div>
  );
}

const PILLARS = ["environment", "social", "governance"] as const;
const PILLAR_LABEL: Record<(typeof PILLARS)[number], string> = {
  environment: "Environment",
  social: "Social",
  governance: "Governance",
};

export function WebsiteAboutPage() {
  const [about, setAbout] = React.useState<api.SiteAbout | null>(null);
  const [leaders, setLeaders] = React.useState<api.Leader[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    Promise.all([api.getAbout(), api.listLeaders()])
      .then(([a, l]) => {
        setAbout(a);
        // Group tier only. An entity's people are edited in its own dossier —
        // showing them here would invite editing a subsidiary's team from a
        // screen titled "the group".
        setLeaders(l.filter((x) => !x.entity_id));
        setLoadError(null);
      })
      .catch((e) => setLoadError(errMsg(e)));
  }, []);

  React.useEffect(load, [load]);

  const set = <K extends keyof api.SiteAbout>(k: K, v: api.SiteAbout[K]) => {
    setSaved(false);
    setAbout((a) => (a ? { ...a, [k]: v } : a));
  };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAbout() {
    if (!about) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.saveAbout(about);
      setSaved(true);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorState message={loadError} action={<Button onClick={load}>{tr("Try again")}</Button>} />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("About your company")}
        description={tr(
          "The story on your public About page. What each legal company does is edited in its own dossier.",
        )}
      />
      <WebsiteNav />

      {actionError && (
        <Callout tone="bad" title={tr("Not saved")}>
          {actionError}
        </Callout>
      )}

      {!about ? null : (
        <>
          <SettingsCard title={tr("Positioning")}>
            <div className="space-y-4">
              <Bilingual
                label={tr("Headline")}
                rows={2}
                fr={about.headline_fr ?? ""}
                en={about.headline_en ?? ""}
                onChange={({ fr, en }) => {
                  set("headline_fr", fr);
                  set("headline_en", en);
                }}
              />
              <Bilingual
                label={tr("Summary")}
                fr={about.summary_fr ?? ""}
                en={about.summary_en ?? ""}
                onChange={({ fr, en }) => {
                  set("summary_fr", fr);
                  set("summary_en", en);
                }}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("Founded")}>
                  <Input
                    type="number"
                    value={about.founded_year ?? ""}
                    onChange={(e) =>
                      set("founded_year", e.target.value ? Number(e.target.value) : null)
                    }
                  />
                </Field>
                <Field label={tr("Headquarters")}>
                  <Input
                    value={about.headquarters ?? ""}
                    onChange={(e) => set("headquarters", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title={tr("Mission and vision")}>
            <div className="space-y-4">
              <Bilingual
                label={tr("Mission")}
                fr={about.mission_fr ?? ""}
                en={about.mission_en ?? ""}
                onChange={({ fr, en }) => {
                  set("mission_fr", fr);
                  set("mission_en", en);
                }}
              />
              <Bilingual
                label={tr("Vision")}
                fr={about.vision_fr ?? ""}
                en={about.vision_en ?? ""}
                onChange={({ fr, en }) => {
                  set("vision_fr", fr);
                  set("vision_en", en);
                }}
              />
            </div>
          </SettingsCard>

          <SettingsCard
            title={tr("ESG")}
            desc={tr(
              "Three pillars, drawn on the site as an illustrated sequence rather than three columns of text.",
            )}
          >
            <div className="space-y-4">
              {PILLARS.map((k) => (
                <div key={k} className="rounded-lg border border-[var(--border)] p-4">
                  <p className="mb-3 text-sm font-semibold">{tr(PILLAR_LABEL[k])}</p>
                  <Bilingual
                    label={tr("Summary")}
                    fr={about.esg?.[k]?.text_fr ?? ""}
                    en={about.esg?.[k]?.text_en ?? ""}
                    onChange={({ fr, en }) =>
                      set("esg", {
                        ...about.esg,
                        [k]: { ...(about.esg?.[k] ?? {}), text_fr: fr, text_en: en },
                      })
                    }
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {(about.esg?.[k]?.points ?? []).length} {tr("bullet points")}
                  </p>
                </div>
              ))}
            </div>
          </SettingsCard>

          {saved && (
            <Callout tone="ok" title={tr("Saved")}>
              {tr("Your About page picks this up on the next page load.")}
            </Callout>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={load} disabled={busy}>
              {tr("Discard changes")}
            </Button>
            <Button onClick={saveAbout} disabled={busy}>
              {busy ? tr("Saving…") : tr("Save story")}
            </Button>
          </div>
        </>
      )}

      <SettingsCard
        title={tr("Group leadership")}
        desc={tr("The people who lead the group. A company's own team is edited in its dossier.")}
      >
        <div className="mb-4">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => api.createLeader({ full_name: tr("New person") }))}
          >
            {tr("Add person")}
          </Button>
        </div>
        {!leaders?.length ? (
          <p className="text-sm text-muted-foreground">{tr("None yet.")}</p>
        ) : (
          <ul className="space-y-4">
            {leaders.map((l) => (
              <li key={l.leader_id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={tr("Name")}>
                    <Input
                      defaultValue={l.full_name}
                      onBlur={(e) =>
                        e.target.value !== l.full_name &&
                        run(() => api.updateLeader(l.leader_id, { full_name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("Role (EN)")}>
                    <Input
                      defaultValue={l.role_en ?? ""}
                      onBlur={(e) =>
                        run(() => api.updateLeader(l.leader_id, { role_en: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("Role (FR)")}>
                    <Input
                      defaultValue={l.role_fr ?? ""}
                      onBlur={(e) =>
                        run(() => api.updateLeader(l.leader_id, { role_fr: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label={tr("LinkedIn")}>
                    <Input
                      defaultValue={l.linkedin_url ?? ""}
                      placeholder="https://www.linkedin.com/in/…"
                      onBlur={(e) =>
                        run(() =>
                          api.updateLeader(l.leader_id, { linkedin_url: e.target.value || null }),
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3">
                  <AssetSlotField
                    slot="leader-portrait"
                    ownerId={l.leader_id}
                    currentId={l.photo_vault_id ?? null}
                    disabled={busy}
                    onChange={load}
                  />
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => api.deleteLeader(l.leader_id))}
                  >
                    {tr("Remove")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
