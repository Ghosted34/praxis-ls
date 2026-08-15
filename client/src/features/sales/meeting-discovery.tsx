/**
 * The Client Discovery Framework — three named sections against one meeting.
 *
 * The legacy captures this in a wizard whose three boxes are columns ON THE
 * LEAD, so the second meeting silently overwrites the first. Here the sections
 * belong to the meeting; the lead reads through to its most recent one.
 *
 * The scripted probing questions above each box are part of the feature, not
 * decoration — a blank box gets blank answers — so they are rendered from the
 * tenant's own (seeded, editable) catalogue rather than hard-coded the way the
 * legacy modal hard-codes them.
 */
import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/modal";
import { Pill, StatusPill } from "@/components/ui/pill";
import { MicIcon, StopIcon } from "@/components/ui/icons";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { enumLabel } from "@/lib/format";
import {
  fetchDiscovery,
  saveDiscoverySection,
  updateMeeting,
  type DiscoverySection,
  type MeetingDiscovery,
  type SectionKey,
} from "@/lib/meeting-api";
import { useDictation } from "@/features/sales/use-dictation";

const HINT: Record<SectionKey, string> = {
  OPERATIONS: "Capture the client's operational reality.",
  PAIN_POINTS: "Capture the cost of inaction — where it hurts, and what it costs.",
  STRATEGY: "Note how we solve these issues, in their language.",
};

/** A section's state, said in words rather than left as a raw enum (§5). */
function CaptureBadge({ section }: { section: DiscoverySection }) {
  if (section.capture_state === "DICTATING")
    return <Pill tone="blue">Transcribing…</Pill>;
  if (section.capture_state === "TRANSCRIPTION_FAILED")
    return <Pill tone="bad">Dictation failed</Pill>;
  if (section.capture_state === "TRANSCRIBED")
    return <Pill tone="ok">Dictated</Pill>;
  if (section.capture_state === "TYPED") return <StatusPill status="Captured" />;
  return <Pill tone="mute">Not captured</Pill>;
}

function MicButton({
  label,
  recording,
  busy,
  disabled,
  onStart,
  onStop,
}: {
  label: string;
  recording: boolean;
  busy: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    // Icon-only, because the pill beside it already says "Transcribing…" or
    // "Dictation failed" in words — a labelled button would state the same thing
    // twice and push the section header onto two lines. `icon={null}` opts out
    // of Button's verb-inferred leading icon, which would sit next to this one.
    <Button
      type="button"
      size="icon"
      icon={null}
      variant={recording ? "destructive" : "outline"}
      loading={busy}
      disabled={disabled}
      onClick={recording ? onStop : onStart}
      title={recording ? "Stop recording" : "Dictate this section"}
      aria-label={
        recording ? `Stop dictating ${label}` : `Dictate ${label} by voice`
      }
    >
      {recording ? <StopIcon /> : <MicIcon />}
    </Button>
  );
}

export function DiscoveryCapture({ meetingId }: { meetingId: string }) {
  const toast = useToast();
  const [data, setData] = React.useState<MeetingDiscovery | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const [drafts, setDrafts] = React.useState<Partial<Record<SectionKey, string>>>({});
  const [saving, setSaving] = React.useState<SectionKey | null>(null);
  const [location, setLocation] = React.useState("");
  const [savingLocation, setSavingLocation] = React.useState(false);

  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  // The drawer already has its record, so the resolver is a formality — the
  // wizard is the caller that actually creates one on first use.
  const resolveMeeting = React.useCallback(async () => meetingId, [meetingId]);
  const dictation = useDictation(resolveMeeting, reload);

  React.useEffect(() => {
    let live = true;
    fetchDiscovery(meetingId)
      .then((d) => {
        if (!live) return;
        setData(d);
        setLocation(d.location ?? "");
        // Only sections the user is NOT mid-edit on are refreshed from the
        // server — a poll landing while somebody is typing must not take the
        // sentence out from under them.
        setDrafts((prev) => {
          const next = { ...prev };
          for (const s of d.sections) {
            if (next[s.section_key] === undefined) next[s.section_key] = s.body ?? "";
          }
          return next;
        });
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [meetingId, tick]);

  async function save(section: SectionKey) {
    setSaving(section);
    try {
      await saveDiscoverySection(meetingId, section, drafts[section] ?? "");
      toast.success("Section saved.");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(null);
    }
  }

  async function saveLocation() {
    setSavingLocation(true);
    try {
      await updateMeeting(meetingId, { location: location.trim() || null });
      toast.success("Location saved.");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingLocation(false);
    }
  }

  if (error)
    return (
      <ScreenError
        message={error}
        what="This meeting's discovery capture"
        onRetry={reload}
      />
    );
  if (!data) return <LoadingRow label="Loading the discovery framework…" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Location" className="min-w-[16rem] flex-1">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Client HQ, Douala"
          />
        </Field>
        <Button
          variant="outline"
          onClick={saveLocation}
          loading={savingLocation}
          disabled={savingLocation || location === (data.location ?? "")}
        >
          Save location
        </Button>
      </div>

      {dictation.error && (
        <ErrorState
          message={dictation.error}
          action={
            <Button size="sm" variant="outline" onClick={dictation.dismissError}>
              Dismiss
            </Button>
          }
        />
      )}

      {data.sections.map((section, i) => {
        const key = section.section_key;
        const recording = dictation.recording === key;
        const pending = dictation.pending === key;
        const label = section.label_en ?? enumLabel(key);
        return (
          <Panel
            key={key}
            titleAs="h3"
            title={`${i + 1}. ${label}`}
            subtitle={HINT[key]}
            action={
              <div className="flex items-center gap-2">
                <CaptureBadge section={section} />
                <MicButton
                  label={label}
                  recording={recording}
                  busy={pending}
                  disabled={
                    (!!dictation.recording && !recording) ||
                    (!!dictation.pending && !pending)
                  }
                  onStart={() => void dictation.start(key)}
                  onStop={dictation.stop}
                />
              </div>
            }
          >
            <div className="space-y-3">
              {!!section.prompts?.length && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Consultative probing questions
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm italic text-muted-foreground">
                    {section.prompts.map((p) => (
                      <li key={p.meeting_discovery_prompt_id}>{p.prompt_en}</li>
                    ))}
                  </ul>
                </div>
              )}

              {section.capture_state === "TRANSCRIPTION_FAILED" && (
                <ErrorState
                  message={`Dictation failed — ${section.dictation_error || "the recording did not come back as text"}. Record it again, or type it below.`}
                />
              )}

              <Field label={`${label} notes`}>
                <Textarea
                  rows={5}
                  value={drafts[key] ?? ""}
                  disabled={recording || pending}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [key]: e.target.value }))
                  }
                  placeholder={HINT[key]}
                />
              </Field>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {recording
                    ? "Recording — press stop when you are done."
                    : pending
                      ? "Transcribing. The text will appear here when it lands."
                      : "Dictation adds to what is already here; it never replaces it."}
                </p>
                <Button
                  size="sm"
                  onClick={() => void save(key)}
                  loading={saving === key}
                  disabled={
                    saving === key ||
                    recording ||
                    pending ||
                    (drafts[key] ?? "") === (section.body ?? "")
                  }
                >
                  Save section
                </Button>
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
