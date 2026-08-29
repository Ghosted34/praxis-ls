/**
 * THE AI SURFACE (§8).
 *
 * ── THE SOURCES STRIP IS THE FEATURE ────────────────────────────────────────
 *
 * An assistant that drafts a reply about an invoice is only useful if the
 * operator can tell whether it read the invoice or invented it. So every draft
 * arrives with three things rendered next to it, and none of them is optional:
 *
 *   SOURCES   which ERP modules were read, and how many facts came from each.
 *   WITHHELD  which were NOT read, and why — usually "you have no grant for
 *             MOD-51". Silently thinner drafts for some users than others is
 *             the version of this that nobody can debug.
 *   FENCE     which values in the draft are not supported by those facts.
 *
 * ── A FENCED DRAFT IS STILL SHOWN ───────────────────────────────────────────
 *
 * When the fact-fence finds a reference or an amount the record does not
 * support, the draft still arrives, with the unsupported values named. A blank
 * composer teaches people to stop using the feature; a marked one teaches them
 * what the assistant does not know. That decision lives server-side; this file
 * has to render the marks or the decision was pointless.
 *
 * ── SUMMARIES ARE NOT FREE ──────────────────────────────────────────────────
 *
 * A summary is a POST because a cache miss spends money. `cached` and `stale_by`
 * come back so the operator can see they are reading a summary of eight
 * messages when the thread now has twelve, and refresh deliberately rather than
 * us re-billing them on every open.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { LoadingRow } from "@/components/ui/states";
import { VoiceInput } from "@/components/voice-input";
import { reportActionError } from "@/lib/action-error";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

const TONES: { value: api.AssistTone; label: string }[] = [
  { value: "formal", label: "Formal" },
  { value: "friendly", label: "Friendly" },
  { value: "concise", label: "Concise" },
  { value: "persuasive", label: "Persuasive" },
  { value: "apologetic", label: "Apologetic" },
  { value: "payment", label: "Payment chase" },
  { value: "escalation", label: "Escalation" },
  { value: "technical", label: "Technical" },
  { value: "followup", label: "Follow-up" },
  { value: "notice", label: "Formal notice" },
];

const ACTIONS: { value: api.AssistAction; label: string }[] = [
  { value: "grammar", label: "Fix grammar" },
  { value: "shorten", label: "Shorten" },
  { value: "expand", label: "Expand" },
];

/** Sources, withheld, fence — the three things that make a draft checkable. */
export function DraftProvenance({ draft }: { draft: api.AssistDraft }) {
  const sources = draft.sources || [];
  const withheld = draft.withheld || [];
  const fence = draft.fence;

  return (
    <div className="space-y-1.5">
      {sources.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tr("Grounded in")}{" "}
          {sources.map((s, i) => (
            <React.Fragment key={s.key}>
              {i > 0 ? " · " : ""}
              <span className="font-medium text-foreground">{s.label}</span>
              <span> ({s.count})</span>
            </React.Fragment>
          ))}
        </p>
      )}

      {withheld.length > 0 && (
        // Named rather than dropped. "The draft is thinner because you cannot
        // read invoices" is actionable; a quietly shorter draft is not.
        <p className="text-xs text-muted-foreground">
          {tr("Not used:")}{" "}
          {withheld.map((w, i) => (
            <React.Fragment key={w.key}>
              {i > 0 ? " · " : ""}
              {w.label} ({w.reason})
            </React.Fragment>
          ))}
        </p>
      )}

      {fence && !fence.ok && (
        <Callout tone="warn" title={tr("Check these before you send.")}>
          {tr("Nothing in the record supports")}{" "}
          <span className="num font-medium">{fence.violations.join(", ")}</span>. {tr("The assistant wrote them anyway — either correct them or delete them.")}
        </Callout>
      )}

      {draft.protected_terms_restored && draft.protected_terms_restored.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {tr("Put back after rewriting:")}{" "}
          <span className="num">{draft.protected_terms_restored.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The composer's assist bar.
 *
 * `getText` and `setText` are passed in rather than the component owning the
 * body, because the composer's editor is the source of truth and a second copy
 * of the draft here would drift the moment someone typed into either one.
 */
export function AssistToolbar({
  threadId,
  getText,
  setText,
  language,
  getSubject,
  getRecipients,
}: {
  threadId?: string | null;
  getText: () => string;
  setText: (text: string) => void;
  language?: "en" | "fr";
  /**
   * The subject line and the addressees, read at the moment the button is
   * pressed.
   *
   * These are the whole difference between "Write it for me" drafting the
   * email in front of the operator and drafting a generic one. On a NEW
   * message the body is empty by definition — the subject is the only thing
   * that has been typed, and it is almost always the topic in full
   * ("Demurrage on MSKU4567890 — request for waiver"). Read through getters
   * rather than passed as values so this bar never holds a second copy of the
   * composer's state; see the note on getText/setText below.
   */
  getSubject?: () => string;
  getRecipients?: () => string[];
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<api.AssistDraft | null>(null);
  const [tone, setTone] = React.useState<api.AssistTone>("formal");
  const [dictation, setDictation] = React.useState("");
  const [showVoice, setShowVoice] = React.useState(false);
  /* §8.3's "Other…" — a sentence of brief in the operator's own words, beside
   * the ten named tones. A preset says HOW to write; this says WHAT about. */
  const [brief, setBrief] = React.useState("");
  const [showBrief, setShowBrief] = React.useState(false);

  async function run(key: string, fn: () => Promise<api.AssistDraft>) {
    setBusy(key);
    setResult(null);
    try {
      const out = await fn();
      setResult(out);
      // The draft replaces the body only when there IS one. An unbound thread
      // returns an empty draft with a note explaining why, and overwriting the
      // operator's text with "" would be the assistant deleting their work.
      if (out.draft_text) setText(out.draft_text);
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(null);
    }
  }

  const hasText = () => Boolean(getText().trim());

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={tone}
          onChange={(e) => setTone(e.target.value as api.AssistTone)}
          aria-label={tr("Tone")}
          className="h-8 w-auto text-xs"
        >
          {TONES.map((t) => (
            <option key={t.value} value={t.value}>{tr(t.label)}</option>
          ))}
        </Select>

        {threadId && (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => run("draft", () => api.assistDraft({ thread_id: threadId, tone, language }))}
          >
            {busy === "draft" ? tr("Drafting…") : tr("Draft a reply")}
          </Button>
        )}

        {/* The subject, the addressees and the brief all ride along. Before
            they did, this button on a blank new message asked the model to
            write about nothing and got exactly that back. */}
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            run("compose", () => api.assistCompose({
              tone,
              language,
              thread_id: threadId || undefined,
              draft: getText() || undefined,
              subject: getSubject?.().trim() || undefined,
              to: getRecipients?.().length ? getRecipients() : undefined,
              instruction: brief.trim() || undefined,
            }))
          }
        >
          {busy === "compose" ? tr("Writing…") : hasText() ? tr("Rewrite in this tone") : tr("Write it for me")}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showBrief}
          onClick={() => setShowBrief((v) => !v)}
          title={tr("Tell it what the email should say, in your own words")}
        >
          {brief.trim() ? tr("Brief ✓") : tr("Other…")}
        </Button>

        {ACTIONS.map((a) => (
          <Button
            key={a.value}
            size="sm"
            variant="ghost"
            disabled={busy !== null || !hasText()}
            onClick={() =>
              run(a.value, () => api.assistRewrite({
                text: getText(), action: a.value, thread_id: threadId || undefined, language,
              }))
            }
          >
            {busy === a.value ? "…" : tr(a.label)}
          </Button>
        ))}

        {(["fr", "en"] as const).map((to) => (
          <Button
            key={to}
            size="sm"
            variant="ghost"
            disabled={busy !== null || !hasText()}
            onClick={() =>
              run(`to_${to}`, () => api.assistTranslate({
                text: getText(), to, thread_id: threadId || undefined,
              }))
            }
          >
            {busy === `to_${to}` ? "…" : to === "fr" ? "En français" : "In English"}
          </Button>
        ))}

        <Button size="sm" variant="ghost" onClick={() => setShowVoice((v) => !v)}>
          {tr("Dictate")}
        </Button>
      </div>

      {showBrief && (
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          placeholder={tr("e.g. Ask them to waive the demurrage, mention we cleared within the free days, and propose a call Thursday.")}
          aria-label={tr("What should it say?")}
          className="text-sm"
        />
      )}

      {showVoice && (
        <div className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-2">
          {/* The MICROPHONE, which is what "Dictate" was always supposed to
              mean (§8.7). This panel used to be a textarea you TYPED into
              under a button labelled Dictate — the opposite of the thing the
              label promised. `VoiceInput` records, posts the clip, and appends
              what it hears; nothing is stored, on our side or the vendor's. */}
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {tr("Hold the microphone and speak. What you say is transcribed here — edit it if you like, then turn it into an email.")}
            </p>
            <VoiceInput
              label={tr("Dictate your message")}
              // Called through an arrow rather than passed by reference: the
              // wiring gate in `tests/security/mail-client-api-wiring.test.js`
              // looks for a call expression on a screen, and a bare reference
              // reads to it as a wrapper nobody reaches. It is also the plainer
              // thing to read — the clip goes to the mail route, not the HR one.
              transcribe={(clip) => api.assistTranscribe(clip)}
              disabled={busy !== null}
              onText={(t) => setDictation((d) => (d ? `${d} ${t}` : t))}
            />
          </div>
          <Textarea
            value={dictation}
            onChange={(e) => setDictation(e.target.value)}
            rows={3}
            placeholder={tr("…or type it here, if you would rather not speak.")}
            aria-label={tr("Dictation")}
            className="text-sm"
          />
          <Button
            size="sm"
            disabled={busy !== null || !dictation.trim()}
            onClick={() =>
              run("voice", () => api.assistVoice({
                transcript: dictation, thread_id: threadId || undefined, tone, language,
              })).then(() => setDictation(""))
            }
          >
            {busy === "voice" ? tr("Turning it into an email…") : tr("Make it an email")}
          </Button>
        </div>
      )}

      {/* Q30: the raw transcript beside the cleaned version, once, so the
          speaker can see what the tidy-up changed rather than trusting it. */}
      {result?.transcript && (
        <p className="text-xs text-muted-foreground">
          {tr("Heard:")} “{result.transcript}”
        </p>
      )}

      {result?.note && (
        // The honest branch: a thread bound to nothing, or every source
        // withheld. Both are fixable, and they are fixed differently.
        <p className="text-xs text-muted-foreground">{result.note}</p>
      )}
      {result && <DraftProvenance draft={result} />}
      <p className="text-xs text-muted-foreground">
        {tr("Everything here lands in the composer. Nothing is sent, and nothing is written to a record.")}
      </p>
    </div>
  );
}

/**
 * The executive summary slot in the reading pane.
 *
 * Never generated on open. A thread under five messages says so instead of
 * spending a model call on something the operator can read faster than we can
 * summarise it.
 */
export function ThreadSummary({ threadId }: { threadId: string }) {
  const [data, setData] = React.useState<api.ThreadSummary | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [asked, setAsked] = React.useState(false);

  React.useEffect(() => { setData(null); setAsked(false); }, [threadId]);

  async function load(force = false) {
    setBusy(true);
    setAsked(true);
    try {
      setData(await api.assistSummary({ thread_id: threadId, force }));
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!asked) {
    return (
      <Button size="sm" variant="outline" onClick={() => load(false)}>
        {tr("Summarise this thread")}
      </Button>
    );
  }
  if (busy && !data) return <LoadingRow label={tr("Reading the thread…")} />;
  if (!data) return null;

  if (data.not_needed) {
    return <p className="text-xs text-muted-foreground">{data.note}</p>;
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{tr("Summary")}</span>
        {data.cached && <Pill tone="mute">{tr("Saved")}</Pill>}
        {/* Visible staleness, so refreshing is the operator's decision rather
            than something we do — and bill for — on every open. */}
        {data.stale_by ? (
          <Pill tone="warn">
            {`${data.stale_by} ${data.stale_by === 1 ? tr("newer message") : tr("newer messages")}`}
          </Pill>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm">{data.summary}</p>
      {data.needs_review && (
        <p className="text-xs text-muted-foreground">
          {tr("Some figures in this summary are not in the record — read it against the thread.")}
        </p>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => load(true)}>
        {busy ? tr("Rewriting…") : tr("Rewrite it")}
      </Button>
    </div>
  );
}
