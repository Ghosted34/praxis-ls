/**
 * The composer.
 *
 * ── AUTOSAVE IS DEBOUNCED AND SENDS ONLY WHAT CHANGED ───────────────────────
 *
 * Every 1.5s of quiet, not every keystroke — and the payload carries the fields
 * that actually moved. The server reads an absent field as "not provided" and a
 * null as "clear it", so sending the whole draft on every save would be both
 * wasteful and, before that distinction existed, destructive.
 *
 * ── SENDING IS OPTIMISTIC ABOUT NOTHING ─────────────────────────────────────
 *
 * The composer closes when the server has accepted the message into the queue,
 * and the undo toast then owns the outcome. It does not close on click: a send
 * that is refused — no recipient, over the rate limit, a mailbox someone lost
 * access to — has to leave the person looking at their text, not at an empty
 * screen wondering where it went.
 *
 * ── OFFLINE ─────────────────────────────────────────────────────────────────
 *
 * A send that cannot reach the server is written to IndexedDB with the same
 * idempotency key it was minted with, and replayed on reconnect. The key is
 * minted ONCE per message, so a replay, a retry and a second tab all collapse
 * into one queued row server-side.
 *
 * ── EXTENSION SLOTS ─────────────────────────────────────────────────────────
 *
 * PR-2 through PR-5 add UI by passing a node into a named slot, never by editing
 * this file. Editing another PR's JSX is what makes parallel work fail.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";
import { useComposerEditor, type JSONContent } from "./use-editor";
import { EditorSurface } from "./editor";
import { ComposerToolbar, FontNote } from "./toolbar";
import { SlashMenu } from "./slash-menu";
import { AttachmentTray, AttachButton } from "./attachment-tray";
import { UndoSendToast } from "./undo-toast";
import { newIdempotencyKey, rememberSend, forgetSend } from "./offline-queue";

/** PR-2..PR-5 register into these rather than editing the markup. */
export type ComposerSlots = {
  "composer.toolbar.right"?: React.ReactNode;
  "composer.footer.left"?: React.ReactNode;
  "composer.footer.right"?: React.ReactNode;
  "composer.presend"?: React.ReactNode;
};

export type ComposerProps = {
  connectionId: string;
  mailboxes?: api.Mailbox[];
  threadId?: string | null;
  replyToMessageId?: string | null;
  kind?: api.Draft["kind"];
  initialTo?: string[];
  initialSubject?: string | null;
  /** The message being replied to, already rendered. Appended below the reply. */
  quotedHtml?: string | null;
  quotedText?: string | null;
  entityRef?: string | null;
  onSent?: () => void;
  onClose?: () => void;
  slots?: ComposerSlots;
};

const splitAddresses = (s: string) =>
  s.split(/[,;]/).map((a) => a.trim()).filter(Boolean);

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(new Error(`Could not read ${file.name}`));
  r.readAsDataURL(file);
});

export function Composer({
  connectionId,
  mailboxes = [],
  threadId = null,
  replyToMessageId = null,
  kind = "NEW",
  initialTo = [],
  initialSubject = null,
  quotedHtml = null,
  quotedText = null,
  entityRef = null,
  onSent,
  onClose,
  slots = {},
}: ComposerProps) {
  const [from, setFrom] = React.useState(connectionId);
  const [to, setTo] = React.useState(initialTo.join(", "));
  const [cc, setCc] = React.useState("");
  const [showCc, setShowCc] = React.useState(false);
  const [subject, setSubject] = React.useState(initialSubject || "");
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const [tray, setTray] = React.useState<api.AttachmentTray | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  const [queued, setQueued] = React.useState<api.QueuedSend | null>(null);
  const [undoState, setUndoState] = React.useState<"held" | "cancelling" | "cancelled" | "gone">("held");
  const [undoError, setUndoError] = React.useState<string | null>(null);

  const [slash, setSlash] = React.useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const commands = useResource(() => api.listCommands(), []);

  const docRef = React.useRef<JSONContent | null>(null);
  const dirtyRef = React.useRef<Record<string, unknown>>({});
  const draftIdRef = React.useRef<string | null>(null);
  draftIdRef.current = draftId;

  const editor = useComposerEditor({
    placeholder: "Write your message — type / to insert from the system",
    onChange: (doc) => {
      docRef.current = doc;
      dirtyRef.current.body_json = doc;
      touch();
    },
  });

  /* ── Autosave ───────────────────────────────────────────────────────────── */

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = React.useCallback(async () => {
    const changed = dirtyRef.current;
    if (!Object.keys(changed).length) return;
    dirtyRef.current = {};
    try {
      const saved = await api.saveDraft({
        email_draft_id: draftIdRef.current || undefined,
        email_connection_id: from,
        email_thread_id: threadId,
        reply_to_message_id: replyToMessageId,
        kind,
        ...changed,
      });
      setDraftId(saved.email_draft_id);
      setSavedAt(saved.updated_at || new Date().toISOString());
      setWarnings(saved.warnings || []);
    } catch (err) {
      // An autosave that fails must not interrupt typing. It is retried on the
      // next change, and Send does its own save first.
      Object.assign(dirtyRef.current, changed);
      reportActionError(err);
    }
  }, [from, threadId, replyToMessageId, kind]);

  const touch = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 1500);
  }, [flush]);

  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setField = (key: string, value: unknown, set: (v: never) => void) => {
    set(value as never);
    dirtyRef.current[key] = value;
    touch();
  };

  /* ── Attachments ────────────────────────────────────────────────────────── */

  const reloadTray = React.useCallback(async (id: string) => {
    try { setTray(await api.draftAttachments(id)); } catch (err) { reportActionError(err); }
  }, []);

  async function attach(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      // The draft has to exist before a file can hang off it.
      let id = draftIdRef.current;
      if (!id) {
        await flush();
        id = draftIdRef.current;
      }
      if (!id) {
        const saved = await api.saveDraft({ email_connection_id: from, email_thread_id: threadId, kind });
        id = saved.email_draft_id;
        setDraftId(id);
      }
      for (const file of files) {
         
        await api.uploadAttachment({
          email_draft_id: id, filename: file.name,
           
          data_url: await fileToDataUrl(file),
        });
      }
      await reloadTray(id);
    } catch (err) {
      // Shown in the composer rather than the global banner: it is about the
      // file the person just picked and belongs next to the tray.
      setError((err as { message?: string })?.message || "That file could not be attached.");
    } finally {
      setBusy(false);
    }
  }

  async function detach(attachmentId: string) {
    if (!draftId) return;
    setBusy(true);
    try {
      await api.removeAttachment(draftId, attachmentId);
      await reloadTray(draftId);
    } catch (err) { reportActionError(err); } finally { setBusy(false); }
  }

  /* ── Slash commands ─────────────────────────────────────────────────────── */

  React.useEffect(() => {
    if (!editor) return undefined;
    const onKey = () => {
      const { state } = editor;
      const before = state.doc.textBetween(Math.max(0, state.selection.from - 40), state.selection.from, "\n", "\0");
      // Open on a "/" that starts a word, so a URL's slashes do not trigger it.
      const m = /(?:^|\s)\/([a-z]*)$/.exec(before);
      setSlash(m ? { open: true, query: m[1] } : { open: false, query: "" });
    };
    editor.on("selectionUpdate", onKey);
    editor.on("update", onKey);
    return () => { editor.off("selectionUpdate", onKey); editor.off("update", onKey); };
  }, [editor]);

  async function runCommand(c: api.CommandDescriptor) {
    setSlash({ open: false, query: "" });
    if (!editor) return;
    try {
      const res = await api.runCommand(c.key, {
        entity_ref: entityRef, email_thread_id: threadId,
      });
      // Replace the "/word" the user typed, then insert the block.
      const { state } = editor;
      const before = state.doc.textBetween(Math.max(0, state.selection.from - 40), state.selection.from, "\n", "\0");
      const m = /(?:^|\s)(\/[a-z]*)$/.exec(before);
      const chain = editor.chain().focus();
      if (m) chain.deleteRange({ from: state.selection.from - m[1].length, to: state.selection.from });
      chain.insertContent(res.node as never).run();

      if (res.attach?.vault_id && draftIdRef.current) {
        await api.attachFromVault({ email_draft_id: draftIdRef.current, vault_id: res.attach.vault_id });
        await reloadTray(draftIdRef.current);
      }
    } catch (err) {
      reportActionError(err);
    }
  }

  /* ── Sending ────────────────────────────────────────────────────────────── */

  async function send() {
    setError(null);
    const recipients = splitAddresses(to);
    if (!recipients.length) { setError("Add at least one recipient."); return; }

    setBusy(true);
    // Minted ONCE per message: a replay, a retry and a second tab all carry this
    // and collapse into one queued row server-side.
    const key = newIdempotencyKey();
    const body = {
      connectionId: from,
      to: recipients,
      cc: showCc ? splitAddresses(cc) : undefined,
      subject: subject || null,
      body_json: docRef.current,
      email_draft_id: draftId,
      email_thread_id: threadId,
      reply_to_message_id: replyToMessageId,
      quoted_html: quotedHtml,
      quoted_text: quotedText,
      idempotency_key: key,
    };

    try {
      await flush();
      const res = await api.sendMessage(body);
      setQueued(res);
      setUndoState("held");
      onSent?.();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === undefined || status === 0) {
        // No answer at all — the network, not a refusal. Keep it and replay.
        await rememberSend({ idempotency_key: key, body, queued_at: Date.now(), attempts: 1 });
        setError("You appear to be offline. This will send when the connection comes back.");
      } else {
        setError((err as { message?: string })?.message || "That message could not be sent.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!queued) return;
    setUndoState("cancelling");
    try {
      await api.cancelSend(queued.email_send_queue_id);
      await forgetSend(queued.email_send_queue_id);
      setUndoState("cancelled");
    } catch (err) {
      // A 409 means the flusher won the race. That is not an error to apologise
      // for — it is the honest answer, and the toast says so.
      setUndoState("gone");
      setUndoError((err as { message?: string })?.message || null);
    }
  }

  const canSend = Boolean(from) && splitAddresses(to).length > 0 && !busy;

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border border-border bg-card"
      aria-label="Compose a message"
    >
      <header className="space-y-1.5 border-b border-border px-3 py-2">
        {mailboxes.length > 1 && (
          <Field label="From">
            <Select
              value={from}
              onChange={(e) => setField("email_connection_id", e.target.value, setFrom as never)}
              className="h-8 text-xs"
            >
              {mailboxes.map((m) => (
                <option key={m.email_connection_id} value={m.email_connection_id}>{m.email_address}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="composer-to" className="w-10 shrink-0 text-xs text-muted-foreground">To</label>
          <Input
            id="composer-to"
            value={to}
            onChange={(e) => setField("to_address", splitAddresses(e.target.value), (() => setTo(e.target.value)) as never)}
            placeholder="name@company.cm"
            className="h-8"
          />
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              Cc
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="composer-cc" className="w-10 shrink-0 text-xs text-muted-foreground">Cc</label>
            <Input
              id="composer-cc"
              value={cc}
              onChange={(e) => setField("cc_address", splitAddresses(e.target.value), (() => setCc(e.target.value)) as never)}
              className="h-8"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="composer-subject" className="w-10 shrink-0 text-xs text-muted-foreground">Subject</label>
          <Input
            id="composer-subject"
            value={subject}
            onChange={(e) => setField("subject", e.target.value, (() => setSubject(e.target.value)) as never)}
            className="h-8"
          />
        </div>
      </header>

      <ComposerToolbar editor={editor} slotRight={slots["composer.toolbar.right"]} />

      <div className="relative" id="composer-body">
        <EditorSurface editor={editor} />
        {slash.open && (
          <SlashMenu
            commands={commands.data || []}
            loading={commands.loading}
            query={slash.query}
            onPick={runCommand}
            onClose={() => setSlash({ open: false, query: "" })}
            ownerEl={(editor?.view?.dom as HTMLElement) || null}
          />
        )}
      </div>
      <FontNote />

      <AttachmentTray tray={tray} onRemove={detach} busy={busy} />

      {/* Warnings from the SERVER's serializer — the same code that will produce
          the message — so they are about what will actually be sent. */}
      {warnings.length > 0 && (
        <div role="status" className="border-t border-border bg-warning/10 px-3 py-2 text-xs">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {error && <div className="px-3 pt-2"><ErrorState message={error} /></div>}
      {slots["composer.presend"]}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button size="sm" onClick={send} disabled={!canSend} loading={busy}>Send</Button>
        <AttachButton onFiles={attach} disabled={busy} />
        {slots["composer.footer.left"]}
        <span className="ml-auto flex items-center gap-2">
          {slots["composer.footer.right"]}
          {savedAt && <Pill tone="mute">Draft saved</Pill>}
          {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
        </span>
      </footer>

      {queued && (
        <div className="border-t border-border p-2">
          <UndoSendToast
            releaseAt={queued.release_at}
            state={undoState}
            error={undoError}
            onUndo={undo}
            onDismiss={() => { setQueued(null); onClose?.(); }}
          />
        </div>
      )}
    </section>
  );
}

export default Composer;
