/**
 * Settings › Website › Careers — what the public careers page offers when
 * nothing is open (13792).
 *
 * ── WHY THIS SCREEN EXISTS AND IS THIS SMALL ──────────────────────────────
 *
 * The careers page is empty more often than it is full — a company of forty
 * hires a handful of times a year and is between rounds the rest of it. What
 * that page SAYS in that state is already this tenant's to write, in both
 * languages, on the Wording screen. What it can DO is not, because a public
 * endpoint cannot be gated by public content: the server has to be able to
 * check, before it writes a stranger's CV into the pipeline, that somebody here
 * asked for that.
 *
 * So this screen is three controls, and deliberately not a page builder:
 *
 *   · OPEN APPLICATIONS. A CV with no vacancy attached. It lands in the same
 *     place a real application does, with `status = TALENT_POOL`, and shows up
 *     in HR › Talent pool › Past applicants labelled "Open application" — a
 *     recruiter can put the person in front of a real role from there with
 *     Consider, exactly as they would a candidate who applied and missed out.
 *   · JOB ALERTS. One email when a role opens, to people who asked for one.
 *     Separate from open applications because a tenant may well want CVs
 *     without committing to write back to anybody.
 *   · CULTURE TAG. Which Insights tag feeds the "Life here" strip on that page.
 *     A tag rather than a second editor: Insights already has one, with a
 *     publish flag and its own tags, and a careers-only copy of all three would
 *     be three chances to disagree with the originals.
 *
 * ── BOTH SWITCHES ARRIVE OFF, AND THAT IS THE DECISION ────────────────────
 *
 * Defaulting them on would have started every existing tenant receiving CVs
 * into a pipeline nobody told them about, from a page they did not change, in
 * an upgrade they did not ask for. Turning one on is a decision with a person
 * behind it, which is what this screen is.
 */
import * as React from "react";
import { PageHeader } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SettingsCard, Field, Toggle } from "@/components/settings/controls";
import { ErrorState } from "@/components/ui/states";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/site-settings-api";
import { WebsiteNav } from "./website-nav";

const EMPTY: api.SiteCareers = {
  open_applications: false,
  alerts_enabled: false,
  culture_tag: null,
};

export function WebsiteCareersPage() {
  const [form, setForm] = React.useState<api.SiteCareers>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const row = await api.getCareers();
      // 13792 seeds the singleton, so a null row means a database restored
      // without it. The defaults are the safe reading of "we do not know":
      // both switches off, nothing offered.
      setForm(row ? { ...EMPTY, ...row } : EMPTY);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveCareers({
        open_applications: form.open_applications,
        alerts_enabled: form.alerts_enabled,
        // Trimmed to null rather than sent blank. An empty tag filters the
        // insight list to nothing, which renders as a configured strip with
        // no content — a tenant reading that sees a broken feature where the
        // truth is that they have not chosen a tag. The shared schema does the
        // same transform, so this agrees with the API rather than duplicating
        // a rule.
        culture_tag: form.culture_tag?.trim() || null,
      });
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof api.SiteCareers>(
    k: K,
    v: api.SiteCareers[K],
  ) => {
    setSaved(false);
    setForm((s) => ({ ...s, [k]: v }));
  };

  return (
    <>
      <PageHeader
        title={tr("Careers page")}
        description={tr(
          "What the public careers page offers when no roles are open.",
        )}
      />
      <WebsiteNav />

      {error && <ErrorState message={error} />}
      {saved && (
        <Callout tone="ok" className="mb-4">
          {tr("Saved. The careers page picks this up on its next load.")}
        </Callout>
      )}

      <SettingsCard
        title={tr("When nothing is open")}
        desc={tr(
          "Both start off. Neither changes what a visitor sees while roles are published.",
        )}
      >
        <div className="flex flex-col gap-3">
          <Toggle
            checked={form.open_applications}
            onChange={(v) => set("open_applications", v)}
            label={tr("Accept open applications")}
            hint={tr(
              "A visitor can send a CV with no role attached. It arrives in HR › Talent pool › Past applicants, marked “Open application”, and can be put forward for a real role from there.",
            )}
          />
          <Toggle
            checked={form.alerts_enabled}
            onChange={(v) => set("alerts_enabled", v)}
            label={tr("Offer job alerts")}
            hint={tr(
              "A visitor can leave an email address and is written to once a day when roles are published — never otherwise, and every message carries an unsubscribe link.",
            )}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title={tr("Life here")}
        desc={tr(
          "An optional strip of your own Insights posts, shown on the careers page whether or not roles are open.",
        )}
      >
        <Field label={tr("Insights tag")}>
          <Input
            value={form.culture_tag || ""}
            maxLength={60}
            placeholder={tr("careers")}
            disabled={busy}
            onChange={(e) => set("culture_tag", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {tr(
              "Published posts carrying this tag appear under “Life here”. Leave it blank for no strip — an empty one reads worse than none.",
            )}
          </p>
        </Field>
      </SettingsCard>

      <div className="mt-5 flex items-center gap-2">
        <Button variant="outline" onClick={() => void load()} disabled={busy}>
          {tr("Reset")}
        </Button>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? tr("Saving…") : tr("Save")}
        </Button>
      </div>
    </>
  );
}
