/**
 * Settings → Calls (Smart Comms PR-3, guide §4.4/§7.2).
 *
 * TWO SWITCHES, TWO AUDIENCES, and that is the whole design of this screen:
 *
 *   1. THE TENANT'S DEFAULT for the yard noise filter
 *      (`comms.call_noise_suppression`). ON by default, because the corridor
 *      has forklifts and the person who needs the filter is standing in a
 *      loading bay, not reading this page.
 *   2. THE PERSON'S OWN preference (`/me/preferences/calls`). It can follow the
 *      tenant (null — the honest "no opinion"), or override it either way. That
 *      is why the control is three-state and not a checkbox: a checkbox cannot
 *      tell "I have not chosen" from "I chose off", and collapsing the two
 *      would either pin every user to the setting as it was on their first
 *      login or ignore the tenant's change of mind forever.
 *
 * The tenant's RECORDING RETENTION (`comms.call_recording.retention_days`,
 * seeded at 30 by 14020) sits here too: it is the same setting section, it is
 * the same reader (`callSettings` in the call service) and it is the number a
 * compliance question is actually about — "how long do you keep the audio?"
 *
 * NOT A DASHBOARD. The call METRICS live on the platform console
 * (`/ops/comms`), because they are read by the platform operator across
 * tenants, not by a tenant administrator about their own company.
 */
import * as React from "react";
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { putSetting } from "@/lib/mail-api";
import { errMsg } from "@/lib/use-resource";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  fetchCallPrefs,
  saveCallPrefs,
  type CallPrefs,
} from "@/lib/preferences";

/** The tenant's call settings, as `setting` rows under section `comms`. */
type TenantCallSettings = {
  noiseSuppression: boolean;
  retentionDays: number;
  /** comms.call_privacy (audit C13): every call through the TURN relay. */
  relayOnly: boolean;
};

const NOISE_KEY = "call_noise_suppression";
const RECORDING_KEY = "call_recording";
const PRIVACY_KEY = "call_privacy";
const SECTION = "comms";

function readBool(v: unknown, fallback: boolean): boolean {
  const raw = (v as { enabled?: unknown } | null)?.enabled;
  if (raw === undefined) return fallback;
  return raw === true || raw === "true";
}

function readRelayOnly(v: unknown): boolean {
  const raw = (v as { relay_only?: unknown } | null)?.relay_only;
  return raw === true || raw === "true";
}

function readDays(v: unknown, fallback: number): number {
  const raw = Number((v as { retention_days?: unknown } | null)?.retention_days);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.trunc(raw), 1), 365);
}

export function CallsPage() {
  const [tenantSettings, setTenantSettings] = React.useState<TenantCallSettings | null>(null);
  const [prefs, setPrefs] = React.useState<CallPrefs | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  /** A refused read of the COMPANY settings, kept apart from the screen's own
   *  error: a person who may set their own preference but not the company's
   *  still gets the half they are allowed, with the other half saying why. */
  const [tenantError, setTenantError] = React.useState<string | null>(null);
  /** A failed read of the PERSON's preference. Named, not swallowed: without
   *  this the screen shows the company default in a control the person does not
   *  own, which reads as "you have no preference" when the truth is "we could
   *  not ask". Class E in doc/ERROR_HANDLING.md — a degraded read the user has
   *  to be able to see. */
  const [prefsError, setPrefsError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    Promise.all([
      // The tenant half comes through the ordinary settings store, so this
      // screen reads exactly what the call service reads — one source of truth,
      // no second copy to drift.
      tenant<{ value?: unknown }>(`/settings/${SECTION}/${NOISE_KEY}`).catch((e) => {
        setTenantError(errMsg(e));
        return null;
      }),
      // Same treatment as the noise key: either half failing means the company
      // defaults on this screen are not the company's, and that is said out
      // loud rather than left to look like the real values.
      tenant<{ value?: unknown }>(`/settings/${SECTION}/${RECORDING_KEY}`).catch((e) => {
        setTenantError(errMsg(e));
        return null;
      }),
      tenant<{ value?: unknown }>(`/settings/${SECTION}/${PRIVACY_KEY}`).catch((e) => {
        setTenantError(errMsg(e));
        return null;
      }),
      // The user half is a preference, not a setting: it belongs to the person
      // and follows them across environments.
      fetchCallPrefs().catch((e) => {
        setPrefsError(errMsg(e));
        return null;
      }),
    ])
      .then(([noise, recording, privacy, mine]) => {
        if (!live) return;
        setTenantSettings({
          noiseSuppression: readBool(noise?.value, true),
          retentionDays: readDays(recording?.value, 30),
          relayOnly: readRelayOnly(privacy?.value),
        });
        // A preference read that failed leaves this null AND raises the note
        // below, so the screen says which of the two happened rather than
        // pretending the person has no opinion.
        setPrefs(mine);
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const saveTenant = async (patch: Partial<TenantCallSettings>) => {
    if (!tenantSettings) return;
    const next = { ...tenantSettings, ...patch };
    setBusy(true);
    setError(null);
    try {
      if (patch.noiseSuppression !== undefined) {
        await putSetting(SECTION, NOISE_KEY, { enabled: next.noiseSuppression });
      }
      if (patch.retentionDays !== undefined) {
        await putSetting(SECTION, RECORDING_KEY, { retention_days: next.retentionDays });
      }
      if (patch.relayOnly !== undefined) {
        await putSetting(SECTION, PRIVACY_KEY, { relay_only: next.relayOnly });
      }
      setTenantSettings(next);
      setSaved(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const saveMine = async (value: boolean | null) => {
    setBusy(true);
    setError(null);
    try {
      const stored = await saveCallPrefs({ noiseSuppression: value });
      setPrefs(stored);
      setSaved(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSkeleton rows={4} cols={2} />;

  const mine = prefs?.noiseSuppression ?? null;
  const effective = mine === null ? (tenantSettings?.noiseSuppression ?? true) : mine;

  return (
    <div className={pageShell.wide}>
      <HubCrumb area="settings" to="/settings" />
      <PageHeader
        title={tr("Calls")}
        description={tr("Voice-call audio handling and how long recordings are kept.")}
      />

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {tenantError && (
        <div className="mb-3">
          <ErrorState
            message={`${tr("Company default")}: ${tenantError}`}
          />
        </div>
      )}

      <Card
        title={tr("Yard noise filter")}
        className="mb-4"
      >
        <p className="text-sm text-muted-foreground">
          {tr(
            "Removes steady background noise — engines, forklifts, a loading bay — from what the other side hears. Every call already has the browser's baseline noise suppression; this is the stronger filter the corridor needs.",
          )}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={tr("Company default")} hint={tr("Applies to everyone who has not chosen for themselves.")}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tenantSettings?.noiseSuppression ?? true}
                disabled={busy}
                onChange={(e) => void saveTenant({ noiseSuppression: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--brand-blue))]"
              />
              {tr("Filter calls by default")}
            </label>
          </Field>

          <Field
            label={tr("My preference")}
            hint={tr("Your choice follows you to every device and overrides the company default.")}
          >
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: null as boolean | null, label: tr("Follow the company") },
                { value: true, label: tr("Always on") },
                { value: false, label: tr("Always off") },
              ].map((opt) => (
                <Button
                  key={String(opt.value)}
                  size="sm"
                  variant={mine === opt.value ? "default" : "ghost"}
                  disabled={busy || prefs === null}
                  onClick={() => void saveMine(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            {prefsError && (
              <p className="mt-2 text-xs text-warn" role="status">
                {tr("Your personal preference could not be read — the company default is shown, but your own setting may differ.")}
              </p>
            )}
          </Field>
        </div>

        {/* Not shown when the personal half could not be read: "in force" is a
            claim about the person's setting, and the screen has just said it
            does not know it. */}
        {prefs !== null && (
          <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
            {tr("In force for you now:")}{" "}
            <strong>{effective ? tr("filter on") : tr("filter off")}</strong>
          </p>
        )}
      </Card>

      <Card title={tr("Call privacy")} className="mb-4">
        <p className="text-sm text-muted-foreground">
          {tr(
            "A direct call lets each person's device learn the other's network address. Relay-only calls send the audio through your company's relay server instead, so no address is shared.",
          )}
        </p>
        <div className="mt-4">
          <Field
            label={tr("Relay-only calls")}
            hint={tr("Needs the call relay (TURN) set up for your company; without it, calls will not connect.")}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tenantSettings?.relayOnly ?? false}
                disabled={busy}
                onChange={(e) => void saveTenant({ relayOnly: e.target.checked })}
                className="h-4 w-4 accent-[rgb(var(--brand-blue))]"
              />
              {tr("Send every call through the relay")}
            </label>
          </Field>
        </div>
      </Card>

      <Card title={tr("Call recordings")}>
        <p className="text-sm text-muted-foreground">
          {tr(
            "Audio is kept only long enough to transcribe and summarize it. The transcript itself lives on with the conversation — the recording does not.",
          )}
        </p>
        <div className="mt-4 max-w-xs">
          <Field label={tr("Keep recordings for (days)")} hint={tr("1–365 days. Default 30.")}>
            <Input
              type="number"
              min={1}
              max={365}
              className="num text-right"
              value={tenantSettings?.retentionDays ?? 30}
              disabled={busy}
              onChange={(e) => {
                const days = Number(e.target.value);
                if (Number.isFinite(days)) {
                  void saveTenant({ retentionDays: Math.min(Math.max(Math.trunc(days), 1), 365) });
                }
              }}
            />
          </Field>
        </div>
      </Card>

      {saved && (
        <p className="mt-3 text-xs text-ok" role="status">
          {saved}
        </p>
      )}
    </div>
  );
}
