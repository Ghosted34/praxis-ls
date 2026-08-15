/**
 * One-step discovery capture — the legacy's "Supply Chain Diagnostic" modal.
 *
 * WHY THIS EXISTS ALONGSIDE THE MEETING DRAWER.
 *
 * The legacy captures a lead, a date, a location and all three sections in one
 * box, because its sections are columns ON THE LEAD and there is no meeting
 * record to make first. This system's sections belong to a meeting, which is
 * the correction — but it turned one action into four (create, find, open,
 * capture), and a capture surface people avoid is a capture surface that stays
 * empty. That is the same failure as the blank box, arrived at from the other
 * side.
 *
 * So this restores the legacy WORKFLOW on top of the corrected model: one save
 * creates the meeting and writes the sections, then hands straight over to the
 * meeting's own discovery tab.
 *
 * THE MICROPHONES, AND WHAT PRESSING ONE COMMITS YOU TO.
 *
 * Dictation needs a meeting to attach the audio and the transcript to, and in
 * this modal the meeting does not exist yet. Pressing a microphone IS the
 * commitment: words a person has already spoken must belong to something, so the
 * record is created at that moment and the section's typed text is saved to it
 * first — dictation appends, and it can only append to what the server has.
 *
 * The consequence is deliberate and is stated in the UI: once you dictate, the
 * meeting exists even if you then cancel. The alternative — holding audio in the
 * browser until Save — throws away a recording on any refresh, close or crash,
 * which is a worse trade for the one thing here that cannot be retyped from
 * memory.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { MicIcon, StopIcon } from "@/components/ui/icons";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { SearchSelect } from "@/components/ui/search-select";
import { useToast } from "@/components/ui/toast";
import { errMsg, type Row } from "@/lib/use-resource";
import {
  createMeeting,
  fetchDiscovery,
  fetchFramework,
  saveDiscoverySection,
  updateMeeting,
  type FrameworkSection,
  type SectionKey,
} from "@/lib/meeting-api";
import { useDictation } from "@/features/sales/use-dictation";

const HINT: Record<SectionKey, string> = {
  OPERATIONS: "Capture the client's operational reality here…",
  PAIN_POINTS: "Capture the cost of inaction and the pain points here…",
  STRATEGY: "Briefly note how we solve these issues, in their language…",
};

/** Today, as a date input wants it. The legacy pre-fills the meeting date and
 *  it is right to: this is filled in immediately after the meeting, and a date
 *  nobody sets is a date nobody can sort by. */
export const todayInput = () => new Date().toISOString().slice(0, 10);

export function DiscoveryWizard({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Handed the created meeting so the caller can open its discovery tab. */
  onSaved: (meeting: Row) => void;
}) {
  const toast = useToast();
  const [framework, setFramework] = React.useState<FrameworkSection[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [withKind, setWithKind] = React.useState<"lead" | "client">("lead");
  const [withId, setWithId] = React.useState("");
  const [withLabel, setWithLabel] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [metOn, setMetOn] = React.useState(todayInput());
  const [location, setLocation] = React.useState("");
  const [bodies, setBodies] = React.useState<Partial<Record<SectionKey, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Null until something commits — a Save, or the first microphone press.
  const [meetingId, setMeetingId] = React.useState<string | null>(null);
  const [states, setStates] = React.useState<Partial<Record<SectionKey, string>>>({});

  React.useEffect(() => {
    if (!open) return;
    setWithKind("lead");
    setWithId("");
    setWithLabel("");
    setSubject("");
    setMetOn(todayInput());
    setLocation("");
    setBodies({});
    setMeetingId(null);
    setStates({});
    setError(null);
    setLoadError(null);
    let live = true;
    fetchFramework()
      .then((f) => live && setFramework(f))
      .catch((e) => live && setLoadError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [open]);

  const captured = Object.values(bodies).filter((b) => (b ?? "").trim()).length;
  const canSubmit = !!withId && (captured > 0 || !!meetingId) && !busy;

  const headerFields = React.useCallback(
    () => ({
      subject:
        subject.trim() ||
        `Client discovery — ${withLabel || (withKind === "lead" ? "lead" : "client")}`,
      [withKind === "lead" ? "lead_id" : "client_id"]: withId,
      scheduled_at: metOn ? new Date(metOn).toISOString() : undefined,
      location: location.trim() || undefined,
    }),
    [location, metOn, subject, withId, withKind, withLabel],
  );

  /**
   * The record, created once and then kept in step with the header fields.
   * Called by Save AND by the first microphone press, which is what stops a
   * dictation and a later Save producing two meetings for one conversation.
   */
  const ensureMeeting = React.useCallback(async (): Promise<string | null> => {
    if (!withId) {
      setError("Pick the lead or client this meeting was with first.");
      return null;
    }
    if (meetingId) {
      // Someone may have set the date or location after dictating; the record
      // should carry what is on screen, not what was on screen at first press.
      await updateMeeting(meetingId, headerFields());
      return meetingId;
    }
    const created = await createMeeting(headerFields());
    const id = String(created.meeting_id);
    setMeetingId(id);
    return id;
  }, [headerFields, meetingId, withId]);

  /** Pull the server's version of every section back into the boxes. The worker
   *  appends the transcript to what was saved, so this is how dictated words
   *  reach the textarea the user is looking at. */
  const refreshFromServer = React.useCallback(() => {
    const id = meetingId;
    if (!id) return;
    void fetchDiscovery(id)
      .then((d) => {
        setBodies((prev) => {
          const next = { ...prev };
          for (const sec of d.sections) next[sec.section_key] = sec.body ?? "";
          return next;
        });
        setStates(
          Object.fromEntries(d.sections.map((sec) => [sec.section_key, sec.capture_state])),
        );
      })
      .catch(() => {
        // The dictation is on the record either way; a failed refresh is a stale
        // textarea, not lost words, and the drawer will show it.
      });
  }, [meetingId]);

  const dictation = useDictation(ensureMeeting, refreshFromServer);

  /**
   * Save what is typed BEFORE opening the microphone. Dictation appends on the
   * server, so anything only in the browser would be overwritten by the refresh
   * that follows the transcript.
   */
  async function dictate(section: SectionKey) {
    setError(null);
    try {
      const id = await ensureMeeting();
      if (!id) return;
      await saveDiscoverySection(id, section, bodies[section] ?? "");
    } catch (e) {
      setError(errMsg(e));
      return;
    }
    void dictation.start(section);
  }

  async function submit() {
    if (!withId) return;
    setBusy(true);
    setError(null);
    try {
      // The meeting first — the sections are its children and cannot be written
      // before it exists. Created here, or already created by a microphone.
      const id = await ensureMeeting();
      if (!id) return;

      // Sequential, not Promise.all: each is an upsert on the same meeting, and
      // a partial failure should leave the earlier sections saved rather than
      // racing three writes and reporting one error for all of them.
      const failed: SectionKey[] = [];
      for (const section of framework ?? []) {
        const body = (bodies[section.key] ?? "").trim();
        if (!body) continue;
        try {
          await saveDiscoverySection(id, section.key, body);
        } catch {
          failed.push(section.key);
        }
      }

      if (failed.length) {
        // The meeting EXISTS — say so, and hand over anyway, because the drawer
        // is where they can retype the section that did not land. Silently
        // closing would look like the whole thing was lost.
        toast.error(
          `Meeting saved, but ${failed.length} section${failed.length > 1 ? "s" : ""} did not — reopen the meeting and re-enter ${failed.length > 1 ? "them" : "it"}.`,
        );
      } else {
        toast.success("Discovery captured.");
      }
      onSaved({ meeting_id: id, subject: headerFields().subject } as unknown as Row);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Supply chain diagnostic"
      description="Client discovery framework — capture the meeting section by section, against the lead it was held with."
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="With">
            <Select
              value={withKind}
              onChange={(e) => {
                setWithKind(e.target.value as "lead" | "client");
                setWithId("");
                setWithLabel("");
              }}
            >
              <option value="lead">Lead</option>
              <option value="client">Client</option>
            </Select>
          </Field>
          <Field label={withKind === "lead" ? "Lead" : "Client"} required>
            <SearchSelect
              path={withKind === "lead" ? "/leads" : "/clients"}
              value={withLabel}
              placeholder={withKind === "lead" ? "Search leads…" : "Search clients…"}
              getLabel={(r) =>
                withKind === "lead"
                  ? String(r.company_name ?? "")
                  : String(r.name ?? r.legal_name ?? "")
              }
              getKey={(r) => String(withKind === "lead" ? r.lead_id : r.client_id)}
              onSelect={(r) => {
                setWithId(String(withKind === "lead" ? r.lead_id : r.client_id));
                setWithLabel(
                  withKind === "lead"
                    ? String(r.company_name ?? "")
                    : String(r.name ?? r.legal_name ?? ""),
                );
              }}
            />
          </Field>
          <Field label="Meeting date">
            <Input
              type="date"
              value={metOn}
              onChange={(e) => setMetOn(e.target.value)}
            />
          </Field>
          <Field label="Location">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Client HQ, Douala"
            />
          </Field>
          <Field
            label="Subject"
            hint="Defaults to the client's name if you leave it blank."
            className="sm:col-span-2"
          >
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Client discovery"
            />
          </Field>
        </div>

        {loadError && <ErrorState message={loadError} />}
        {framework === null && !loadError ? (
          <LoadingRow label="Loading the discovery framework…" />
        ) : (
          (framework ?? []).map((section, i) => (
            <div key={section.key} className="rounded-xl border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {i + 1}. {section.label_en}
                </h3>
                <div className="flex items-center gap-2">
                  {states[section.key] === "TRANSCRIPTION_FAILED" && (
                    <Pill tone="bad">Dictation failed</Pill>
                  )}
                  {states[section.key] === "TRANSCRIBED" && <Pill tone="ok">Dictated</Pill>}
                  {dictation.recording === section.key && <Pill tone="bad">Recording…</Pill>}
                  {dictation.pending === section.key && <Pill tone="blue">Transcribing…</Pill>}
                  {/* Icon-only — the pill beside it carries the state in words. */}
                  <Button
                    type="button"
                    size="icon"
                    icon={null}
                    variant={dictation.recording === section.key ? "destructive" : "outline"}
                    loading={dictation.pending === section.key}
                    // A microphone with no lead behind it would create a meeting
                    // attached to nobody, so it waits for the picker.
                    disabled={
                      !withId ||
                      busy ||
                      (!!dictation.recording && dictation.recording !== section.key) ||
                      (!!dictation.pending && dictation.pending !== section.key)
                    }
                    onClick={() =>
                      dictation.recording === section.key
                        ? dictation.stop()
                        : void dictate(section.key)
                    }
                    aria-label={
                      dictation.recording === section.key
                        ? `Stop dictating ${section.label_en}`
                        : `Dictate ${section.label_en} by voice`
                    }
                    title={
                      dictation.recording === section.key
                        ? "Stop recording"
                        : "Dictate this section"
                    }
                  >
                    {dictation.recording === section.key ? <StopIcon /> : <MicIcon />}
                  </Button>
                </div>
              </div>
              {!!section.prompts.length && (
                <div className="mb-3 rounded-lg border bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Consultative probing questions
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm italic text-muted-foreground">
                    {section.prompts.map((q) => (
                      <li key={q.meeting_discovery_prompt_id}>{q.prompt_en}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label={`${section.label_en} notes`}>
                <Textarea
                  rows={4}
                  value={bodies[section.key] ?? ""}
                  disabled={
                    dictation.recording === section.key ||
                    dictation.pending === section.key
                  }
                  onChange={(e) =>
                    setBodies((b) => ({ ...b, [section.key]: e.target.value }))
                  }
                  placeholder={HINT[section.key]}
                />
              </Field>
            </div>
          ))
        )}

        {error && <ErrorState message={error} />}
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

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {meetingId
              ? "This meeting already exists — it was created when you dictated. Save to keep the typed sections too."
              : !withId
                ? "Pick a lead or client to enable dictation."
                : "Dictation adds to what is already typed; it never replaces it."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={!canSubmit}>
              Secure diagnostic data
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
