/**
 * Settings → Calls (Smart Comms PR-3, guide §4.4/§7.2).
 *
 * "This device" comes first: whether a call can ring here with the app
 * closed, each missing piece with its fix, and a Test ring (audit A15).
 *
 * Then TWO SWITCHES, TWO AUDIENCES:
 *
 *   1. THE TENANT'S DEFAULT for the yard noise filter
 *      (`comms.call_noise_suppression`). Off by default until the filter is
 *      verified on devices (audit E5); a company can turn it on here.
 *   2. THE PERSON'S OWN preference (`/me/preferences/calls`). It can follow the
 *      tenant (null — the honest "no opinion"), or override it either way. That
 *      is why the control is three-state and not a checkbox: a checkbox cannot
 *      tell "I have not chosen" from "I chose off", and collapsing the two
 *      would either pin every user to the setting as it was on their first
 *      login or ignore the tenant's change of mind forever.
 *
 * CALL RECORDING (calls audit PR-6, G1–G4). `comms.call_recording` holds the
 * tenant's opt-in (`enabled`, off unless the company turns it on), how long
 * the audio is kept (`retention_days`) and how long transcripts are kept
 * (`transcript_retention_days`, empty = with the conversation). The three live
 * in ONE setting value, so every save writes the merged value: a PUT replaces
 * the whole value, and saving the audio days alone used to drop the other two.
 * "How calls are processed" names the outside companies that receive call
 * data, read from the server's configured vendors rather than written here.
 *
 * The person's own call preferences (do not disturb, quiet hours, hide my
 * last seen) and a settings admin's audited erasure of one person's call
 * records close the page.
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
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { putSetting } from "@/lib/mail-api";
import { errMsg } from "@/lib/use-resource";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { SearchSelect, type Row } from "@/components/ui/search-select";
import { useConfirm } from "@/components/ui/use-confirm";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  fetchCallPrefs,
  saveCallPrefs,
  type CallPrefs,
} from "@/lib/preferences";
import {
  eraseUserCallRecords,
  fetchCallCapabilities,
  fetchCallProcessing,
  type CallCapabilities,
  type CallProcessing,
  type CallProcessor,
} from "@/lib/smartcomm-api";
import { DeviceRingCard } from "./device-ring-card";

type TenantCallSettings = {
  noiseSuppression: boolean;
  /** comms.call_recording.enabled — the company's opt-in (G1). */
  recordingEnabled: boolean;
  retentionDays: number;
  /** comms.call_recording.transcript_retention_days; null = with the conversation. */
  transcriptDays: number | null;
  /** comms.call_privacy (audit C13): every call through the TURN relay. */
  relayOnly: boolean;
};

const NOISE_KEY = "call_noise_suppression";
const RECORDING_KEY = "call_recording";
const PRIVACY_KEY = "call_privacy";
const SECTION = "comms";
const TRANSCRIPT_MIN = 30;
const TRANSCRIPT_MAX = 3650;

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

function readTranscriptDays(v: unknown): number | null {
  const raw = (v as { transcript_retention_days?: unknown } | null)?.transcript_retention_days;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.trunc(n), TRANSCRIPT_MIN), TRANSCRIPT_MAX);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const ROLE_LABEL: Record<string, string> = {
  first: "First choice",
  when_first_fails: "When the first fails",
  last_resort: "Last resort",
  connection_setup: "Connection set-up only (no audio)",
};

function ProcessorList({ title, rows }: { title: string; rows: CallProcessor[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.map((p) => (
          <li key={`${p.vendor}-${p.role}`}>
            <span className="font-medium">{p.name}</span>{" "}
            <span className="text-muted-foreground">
              · {tr(ROLE_LABEL[p.role] ?? p.role)} · {p.country}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const userText = (u: Row) => String(u.full_name ?? u.name ?? u.email ?? u.user_id ?? "");

export function CallsPage() {
  const [tenantSettings, setTenantSettings] = React.useState<TenantCallSettings | null>(null);
  /** The stored comms.call_recording value, whole: every save merges into it. */
  const recordingRaw = React.useRef<Record<string, unknown>>({});
  const [prefs, setPrefs] = React.useState<CallPrefs | null>(null);
  const [caps, setCaps] = React.useState<CallCapabilities | null>(null);
  const [processing, setProcessing] = React.useState<CallProcessing | null>(null);
  const [processingError, setProcessingError] = React.useState<string | null>(null);
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
  const [eraseUser, setEraseUser] = React.useState<{ id: string; name: string } | null>(null);
  const [erased, setErased] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

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
      // Who may do what here. A failed read hides the admin-only erasure
      // rather than offering a button the server would refuse.
      fetchCallCapabilities().catch(() => {
        /* @silent:parse — no answer means no admin controls; the server refuses them anyway. */
        return null;
      }),
      fetchCallProcessing().catch((e) => {
        setProcessingError(errMsg(e));
        return null;
      }),
    ])
      .then(([noise, recording, privacy, mine, capabilities, disclosure]) => {
        if (!live) return;
        recordingRaw.current = asObject(recording?.value);
        setTenantSettings({
          noiseSuppression: readBool(noise?.value, false),
          recordingEnabled: readBool(recording?.value, false),
          retentionDays: readDays(recording?.value, 30),
          transcriptDays: readTranscriptDays(recording?.value),
          relayOnly: readRelayOnly(privacy?.value),
        });
        // A preference read that failed leaves this null AND raises the note
        // below, so the screen says which of the two happened rather than
        // pretending the person has no opinion.
        setPrefs(mine);
        setCaps(capabilities);
        setProcessing(disclosure);
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
      if (patch.recordingEnabled !== undefined || patch.retentionDays !== undefined || patch.transcriptDays !== undefined) {
        // One value, three fields: write them all, over whatever else is stored.
        const value = {
          ...recordingRaw.current,
          enabled: next.recordingEnabled,
          retention_days: next.retentionDays,
          transcript_retention_days: next.transcriptDays,
        };
        await putSetting(SECTION, RECORDING_KEY, value);
        recordingRaw.current = value;
      }
      if (patch.relayOnly !== undefined) {
        await putSetting(SECTION, PRIVACY_KEY, { relay_only: next.relayOnly });
      }
      setTenantSettings(next);
      if (patch.recordingEnabled !== undefined) {
        setProcessing((p) => (p ? { ...p, recording_enabled: next.recordingEnabled } : p));
      }
      setSaved(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const saveMine = async (patch: Partial<CallPrefs>) => {
    setBusy(true);
    setError(null);
    try {
      const stored = await saveCallPrefs(patch);
      setPrefs(stored);
      setSaved(tr("Saved"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const erase = async () => {
    if (!eraseUser) return;
    const ok = await confirm({
      title: tv("Erase {{name}}'s call records?", { name: eraseUser.name }),
      body: tr(
        "Deletes the audio, transcripts, live notes and unsent summary drafts of every call this person took part in, for both sides of each call. Summaries already sent to a conversation stay there. This cannot be undone.",
      ),
      confirmLabel: tr("Erase call records"),
      cancelLabel: tr("Keep them"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setErased(null);
    try {
      const r = await eraseUserCallRecords(eraseUser.id);
      setErased(
        tv("Erased {{calls}} calls: {{parts}} audio parts, {{transcripts}} transcripts, {{drafts}} drafts.", {
          calls: r.calls,
          parts: r.audio_parts,
          transcripts: r.transcripts,
          drafts: r.drafts,
        }),
      );
      setEraseUser(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageSkeleton rows={4} cols={2} />;

  const mine = prefs?.noiseSuppression ?? null;
  const effective = mine === null ? (tenantSettings?.noiseSuppression ?? false) : mine;
  const tenantLocked = busy || tenantSettings === null || !!tenantError || (caps !== null && !caps.settings_admin);
  /**
   * Relay-only cannot be switched ON into a deployment with no relay: the
   * switch is honoured literally, so every call would simply fail to connect.
   * A tenant who already has it on keeps the ability to switch it OFF, which
   * is the one action that fixes calls for them right now.
   */
  const relayBlocked = processing !== null && !processing.relay_configured && !tenantSettings?.relayOnly;
  const quiet = prefs?.quietHours ?? null;

  return (
    <div className={pageShell.wide}>
      <HubCrumb area="settings" to="/settings" />
      <PageHeader
        title={tr("Calls")}
        description={tr("Whether this device can ring, recording and privacy, and your own call preferences.")}
      />

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {/* F10: company settings are MOD-70's. Someone without it is told so
          plainly, not shown the 403 the read came back with. */}
      {caps && !caps.settings_admin ? (
        <div className="mb-3">
          <Callout tone="info">
            {tr("Company call settings are shown for reference. Only a settings administrator can change them.")}
          </Callout>
        </div>
      ) : tenantError ? (
        <div className="mb-3">
          <ErrorState
            message={`${tr("Company default")}: ${tenantError}`}
          />
        </div>
      ) : null}

      <DeviceRingCard />

      <Panel title={tr("Yard noise filter")} className="mb-4">
        <p className="text-sm text-muted-foreground">
          {tr(
            "Removes steady background noise — engines, forklifts, a loading bay — from what the other side hears. Every call already has the browser's baseline noise suppression; this is the stronger filter the corridor needs.",
          )}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={tr("Company default")} hint={tr("Applies to everyone who has not chosen for themselves.")}>
            <Checkbox
              checked={tenantSettings?.noiseSuppression ?? false}
              disabled={tenantLocked}
              onCheckedChange={(v) => void saveTenant({ noiseSuppression: v })}
              label={tr("Filter calls by default")}
            />
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
                  aria-pressed={mine === opt.value}
                  disabled={busy || prefs === null}
                  onClick={() => void saveMine({ noiseSuppression: opt.value })}
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
      </Panel>

      <Panel title={tr("Call privacy")} className="mb-4">
        <p className="text-sm text-muted-foreground">
          {tr(
            "A direct call lets each person's device learn the other's network address. Relay-only calls send the audio through your company's relay server instead, so no address is shared.",
          )}
        </p>
        {relayBlocked && (
          <Callout tone="warn" title={tr("No call relay is configured")} className="mt-4">
            {tr(
              "This deployment has no relay server set up yet, so relay-only calls would not connect at all. An administrator has to configure the relay before this can be switched on.",
            )}
          </Callout>
        )}
        <div className="mt-4">
          <Field
            label={tr("Relay-only calls")}
            hint={tr("Needs the call relay (TURN) set up for your company; without it, calls will not connect.")}
          >
            <Checkbox
              checked={tenantSettings?.relayOnly ?? false}
              disabled={tenantLocked || relayBlocked}
              onCheckedChange={(v) => void saveTenant({ relayOnly: v })}
              label={tr("Send every call through the relay")}
            />
          </Field>
        </div>
      </Panel>

      <Panel title={tr("Call recording")} className="mb-4">
        <p className="text-sm text-muted-foreground">
          {tr(
            "When recording is on, each call's audio is transcribed and summarised for the conversation. Both people are told before they answer, and the person called can answer without recording.",
          )}
        </p>
        <div className="mt-4 space-y-4">
          <Checkbox
            checked={tenantSettings?.recordingEnabled ?? false}
            disabled={tenantLocked}
            onCheckedChange={(v) => void saveTenant({ recordingEnabled: v })}
            label={tr("Record and summarise calls")}
            hint={tr("Off unless your company turns it on. It also needs the call recording feature switched on for your company.")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Keep recordings for (days)")} hint={tr("1–365 days. Default 30. Audio is kept only long enough to transcribe and summarise it.")}>
              <Input
                key={`audio-${tenantSettings?.retentionDays ?? 30}`}
                type="number"
                min={1}
                max={365}
                className="num text-right"
                defaultValue={tenantSettings?.retentionDays ?? 30}
                disabled={tenantLocked}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (!Number.isFinite(days) || e.target.value === "") return;
                  const next = Math.min(Math.max(Math.trunc(days), 1), 365);
                  if (next !== tenantSettings?.retentionDays) void saveTenant({ retentionDays: next });
                }}
              />
            </Field>
            <Field
              label={tr("Keep transcripts for (days)")}
              hint={tv("Empty keeps them with the conversation. {{min}}–{{max}} days otherwise.", { min: TRANSCRIPT_MIN, max: TRANSCRIPT_MAX })}
            >
              <Input
                key={`text-${tenantSettings?.transcriptDays ?? "none"}`}
                type="number"
                min={TRANSCRIPT_MIN}
                max={TRANSCRIPT_MAX}
                className="num text-right"
                defaultValue={tenantSettings?.transcriptDays ?? ""}
                disabled={tenantLocked}
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  const next = text === ""
                    ? null
                    : Math.min(Math.max(Math.trunc(Number(text)), TRANSCRIPT_MIN), TRANSCRIPT_MAX);
                  if (next !== null && !Number.isFinite(next)) return;
                  if (next !== (tenantSettings?.transcriptDays ?? null)) void saveTenant({ transcriptDays: next });
                }}
              />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel title={tr("How calls are processed")} className="mb-4">
        {processingError ? (
          <ErrorState message={processingError} />
        ) : processing ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {processing.recording_enabled
                ? tr("Recording is on. These outside companies receive call data:")
                : tr("Recording is off, so no call audio leaves Praxis. If it is turned on, these outside companies receive call data:")}
            </p>
            <ProcessorList title={tr("Transcription (the call's audio)")} rows={processing.transcription} />
            <ProcessorList title={tr("Summary (the transcript)")} rows={processing.summary} />
            <ProcessorList title={tr("Network")} rows={processing.network} />
            {processing.transcription.length === 0 && processing.summary.length === 0 && (
              <p className="text-sm">{tr("No transcription or summary provider is configured, so calls are not transcribed.")}</p>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel title={tr("My call preferences")} className="mb-4">
        {prefs === null ? (
          <p className="text-sm text-warn" role="status">
            {tr("Your call preferences could not be read, so they cannot be changed right now.")}
          </p>
        ) : (
          <div className="space-y-4">
            <Checkbox
              checked={prefs.doNotDisturb === true}
              disabled={busy}
              onCheckedChange={(v) => void saveMine({ doNotDisturb: v })}
              label={tr("Do not disturb")}
              hint={tr("Calls to you are refused and the caller is told you are not taking calls.")}
            />
            <div>
              <Checkbox
                checked={quiet !== null}
                disabled={busy}
                onCheckedChange={(v) => void saveMine({ quietHours: v ? { from: "20:00", to: "07:00" } : null })}
                label={tr("Quiet hours")}
                hint={tr("Call summaries still arrive in the app, without an email or a push notification during these hours.")}
              />
              {quiet && (
                <div className="mt-2 grid max-w-sm grid-cols-2 gap-3 pl-6">
                  <Field label={tr("From")}>
                    <Input
                      type="time"
                      value={quiet.from}
                      disabled={busy}
                      onChange={(e) => e.target.value && void saveMine({ quietHours: { ...quiet, from: e.target.value } })}
                    />
                  </Field>
                  <Field label={tr("To")}>
                    <Input
                      type="time"
                      value={quiet.to}
                      disabled={busy}
                      onChange={(e) => e.target.value && void saveMine({ quietHours: { ...quiet, to: e.target.value } })}
                    />
                  </Field>
                </div>
              )}
            </div>
            <Checkbox
              checked={prefs.hideLastSeen === true}
              disabled={busy}
              onCheckedChange={(v) => void saveMine({ hideLastSeen: v })}
              label={tr("Hide my last seen")}
              hint={tr("Colleagues see whether you are online now, but not when you were last active.")}
            />
          </div>
        )}
      </Panel>

      {caps?.settings_admin && (
        <Panel title={tr("Erase a person's call records")}>
          <p className="text-sm text-muted-foreground">
            {tr("For a data-protection request. The erasure is recorded in the audit log.")}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={tr("Person")} className="min-w-[16rem] flex-1">
              <SearchSelect
                path="/users"
                label={tr("Person")}
                value={eraseUser?.name ?? null}
                placeholder={tr("Search users…")}
                getLabel={userText}
                getKey={(u) => String(u.user_id)}
                onSelect={(u) => setEraseUser({ id: String(u.user_id), name: userText(u) })}
              />
            </Field>
            <Button variant="destructive" disabled={busy || !eraseUser} onClick={() => void erase()}>
              {tr("Erase call records")}
            </Button>
          </div>
          {erased && (
            <div className="mt-3">
              <Callout tone="ok">{erased}</Callout>
            </div>
          )}
        </Panel>
      )}

      {saved && (
        <p className="mt-3 text-xs text-ok" role="status">
          {saved}
        </p>
      )}
      {confirmDialog}
    </div>
  );
}
