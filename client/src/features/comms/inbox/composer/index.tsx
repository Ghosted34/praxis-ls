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
import { tr } from "@/lib/i18n";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";
import { useComposerEditor, type JSONContent } from "./use-editor";
import { EditorSurface } from "./editor";
import { ComposerToolbar, FontNote } from "./toolbar";
import { SlashMenu } from "./slash-menu";
import { AttachmentTray, AttachButton } from "./attachment-tray";
import { RecipientField, type ExtraRecipient } from "./recipient-field";
import { UndoSendToast } from "./undo-toast";
import { AssistToolbar } from "../work/assist";
import { GuardrailBar } from "../work/guardrails";
import { useGuardrails } from "../work/use-guardrails";
import { useThreadLock } from "../work/use-thread-lock";
import { useRecipientHealth } from "../work/use-recipient-health";
import { SchedulePicker } from "../work/schedule";
import { schedulePayload, type ScheduleChoice } from "../work/schedule-payload";
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
  initialCc?: string[];
  initialSubject?: string | null;
  /** Plain text to open the body on — a covering note the operator then edits. */
  initialBodyText?: string | null;
  /**
   * Files already in the vault to hang off this draft the moment it exists.
   *
   * The document case: the PDF is rendered and vaulted BEFORE the composer
   * opens, so the operator never sees a compose window whose attachment is
   * still being produced — writing the note, pressing send, and only then
   * learning the document was missing is not a recoverable order of events.
   */
  initialVaultAttachments?: { vault_id: string; filename?: string | null }[];
  /**
   * Addresses this record supplies, offered in To/Cc beside the search.
   *
   * Gated searches can legitimately return nothing for someone who may raise a
   * document but not browse the party register; the counterparty the document
   * is addressed to still has to be reachable. See recipient-field.tsx.
   */
  recipientExtras?: ExtraRecipient[];
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
  r.onerror = () => reject(new Error(`${tr("Could not read")} ${file.name}`));
  r.readAsDataURL(file);
});

export function Composer({
  connectionId,
  mailboxes = [],
  threadId = null,
  replyToMessageId = null,
  kind = "NEW",
  initialTo = [],
  initialCc = [],
  initialSubject = null,
  initialBodyText = null,
  initialVaultAttachments = [],
  recipientExtras = [],
  quotedHtml = null,
  quotedText = null,
  entityRef = null,
  onSent,
  onClose,
  slots = {},
}: ComposerProps) {
  const [from, setFrom] = React.useState(connectionId);
  const [to, setTo] = React.useState(initialTo.join(", "));
  const [cc, setCc] = React.useState(initialCc.join(", "));
  const [showCc, setShowCc] = React.useState(initialCc.length > 0);
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

  /* ── PR-4 §8.8 and PR-5 §9.3 ──────────────────────────────────────────────
   *
   * `override` is the reason typed into the guardrail bar when the send is
   * blocked. It is sent as `guardrail_override_reason` and the SERVER decides
   * whether it releases the block — this component cannot let anything through
   * on its own, which is the correct amount of authority for a client.
   *
   * `schedule` and undo-send are the same mechanism with different delays, so
   * exactly one of them decides the release time. A scheduled message comes
   * back with `undo_seconds: 0` and must not draw a countdown toast. */
  const [override, setOverride] = React.useState("");
  const [schedule, setSchedule] = React.useState<ScheduleChoice>({ kind: "NOW" });

  const [slash, setSlash] = React.useState<{ open: boolean; query: string }>({ open: false, query: "" });
  const commands = useResource(() => api.listCommands(), []);

  const docRef = React.useRef<JSONContent | null>(null);
  const dirtyRef = React.useRef<Record<string, unknown>>({});
  const draftIdRef = React.useRef<string | null>(null);
  draftIdRef.current = draftId;

  const editor = useComposerEditor({
    placeholder: tr("Write your message — type / to insert from the system"),
    onChange: (doc) => {
      docRef.current = doc;
      dirtyRef.current.body_json = doc;
      touch();
    },
  });

  /* ── The body, for the assist toolbar and the guardrail check ─────────────
   *
   * Read and written THROUGH the editor rather than mirrored into state. Two
   * copies of a draft drift the moment anyone types into either one, and the
   * one that loses is always the one the user was looking at. */
  const getBodyText = React.useCallback(() => editor?.getText() || "", [editor]);
  const setBodyText = React.useCallback(
    (text: string) => {
      if (!editor) return;
      editor.commands.setContent(
        text.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] })),
      );
      editor.commands.focus("end");
    },
    [editor],
  );

  /* Advisory only. The authoritative run is inside the send path
   * (`mail/presend.js`), which is what makes §8.8's block a block rather than a
   * suggestion a client may decline to request. This exists so the operator
   * sees it BEFORE pressing send. */
  const guardrails = useGuardrails({
    enabled: true,
    html: editor?.getHTML() || "",
    subject,
    to: splitAddresses(to),
    attachments: (tray?.attachments || []).map((a) => ({ filename: a.filename || undefined })),
  });

  /* ── §9.2 · the soft lock, and §9.8 · the recipients ──────────────────────
   *
   * Both were built end to end and reached by nobody. The lock is taken for as
   * long as this component is mounted on a thread, which is what "opening the
   * composer takes a two-minute lock" means; the recipient check runs whenever
   * the To/Cc list settles. Neither can stop a send — one is advice about a
   * colleague, the other advice about an address, and the person at the
   * keyboard may have a reason for both. */
  const { heldByOther } = useThreadLock({ threadId, enabled: !!threadId });
  const recipients = useRecipientHealth({
    addresses: [...splitAddresses(to), ...splitAddresses(cc)],
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

  /**
   * The draft id, creating the row if this is the first thing to need one.
   *
   * An attachment hangs off a draft, so on a NEW message — where nothing has
   * been typed yet and autosave has not fired — the row has to be brought into
   * existence before the first file can be attached.
   */
  const ensureDraft = React.useCallback(async () => {
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
    return id;
  }, [flush, from, threadId, kind]);

  /* ── Seeded attachments ───────────────────────────────────────────────────
   *
   * Runs once, on open. The PDF was rendered and vaulted by the endpoint that
   * produced this prefill, so all that is left is to point the draft at it.
   *
   * A failure here is LOUD, unlike an autosave failure: the whole reason this
   * composer opened is to send that document, and a silent miss means the
   * operator sends a covering note attached to nothing. */
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !initialVaultAttachments.length) return;
    seeded.current = true;
    (async () => {
      setBusy(true);
      try {
        const id = await ensureDraft();
        if (!id) throw new Error(tr("The draft could not be created."));
        for (const a of initialVaultAttachments) {
           
          await api.attachFromVault({
            email_draft_id: id, vault_id: a.vault_id, filename: a.filename || undefined,
          });
        }
        await reloadTray(id);
      } catch (err) {
        setError((err as { message?: string })?.message || tr("The document could not be attached."));
      } finally {
        setBusy(false);
      }
    })();
  }, [initialVaultAttachments, ensureDraft, reloadTray]);

  /* The covering note, once. Written through the editor rather than mirrored
     into state, for the reason `setBodyText` documents. */
  const bodySeeded = React.useRef(false);
  React.useEffect(() => {
    if (bodySeeded.current || !editor || !initialBodyText) return;
    bodySeeded.current = true;
    setBodyText(initialBodyText);
    dirtyRef.current.body_json = docRef.current;
    touch();
  }, [editor, initialBodyText, setBodyText, touch]);

  async function attach(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureDraft();
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
      setError((err as { message?: string })?.message || tr("That file could not be attached."));
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

  /**
   * Swap a large attachment for a secure link (§9.4).
   *
   * `outbox.service` has computed `offer_secure_link` since PR-1B — a
   * SECURE_LINK_HINT_BYTES constant, a flag on every tray response, and a
   * caption in the composer reading "arrives in a later release". It arrived
   * with PR-5 and the caption stayed, which is worse than never having promised
   * it: the operator reads it, believes the feature is missing, and attaches the
   * 18 MB PDF anyway.
   *
   * The link goes into the BODY and the attachment comes off. Doing only the
   * first would send both, which is the 18 MB message plus a link to it.
   */
  async function sendAsSecureLink(a: {
    email_attachment_id: string;
    vault_id?: string | null;
    filename?: string | null;
  }) {
    if (!a.vault_id) return;
    setBusy(true);
    try {
      const link = await api.createSecureLink({
        target_kind: "VAULT_DOC",
        target_ref: a.vault_id,
        label: a.filename || undefined,
        days: 7,
      });
      const url = link.url || (link.token ? `${window.location.origin}/s/${link.token}` : "");
      if (!url) throw new Error(tr("The link came back without an address."));
      editor
        ?.chain()
        .focus("end")
        .insertContent(
          `<p>${a.filename || tr("Document")}: <a href="${url}">${url}</a> ` +
          `<em>(${tr("expires")} ${new Date(link.expires_at).toLocaleDateString()})</em></p>`,
        )
        .run();
      await detach(a.email_attachment_id);
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /* ── Sending ────────────────────────────────────────────────────────────── */

  async function send() {
    setError(null);
    const recipients = splitAddresses(to);
    if (!recipients.length) { setError(tr("Add at least one recipient.")); return; }

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
      // Exactly one of `send_at` / `send_in_recipient_morning`, or neither.
      // See `work/schedule.tsx` — there is deliberately no "best time to send".
      ...schedulePayload(schedule),
      // Empty unless the guardrail bar is showing a block and the operator has
      // typed a reason. The server refuses the send without one, and writes it
      // to the immutable ledger with their name on it when there is.
      guardrail_override_reason: override.trim() || undefined,
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
        setError(tr("You appear to be offline. This will send when the connection comes back."));
      } else {
        setError((err as { message?: string })?.message || tr("That message could not be sent."));
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

  // An empty editor is not a body. The server refuses such a message — a
  // serialized shell is not content (2026-08-25: recipients got a subject
  // with nothing under it) — and the undo window must not start for a mail
  // that has nothing to say. A reply may be empty in the editor only when it
  // still carries the quoted mail, which the serializer appends below the
  // reply. `editor.isEmpty` is TipTap's own rule: false for a document that
  // carries only an image or an ERP block, which are legitimate bodies.
  const hasBody = editor ? !editor.isEmpty : false;
  const canSend =
    Boolean(from) &&
    splitAddresses(to).length > 0 &&
    (hasBody || Boolean(quotedHtml)) &&
    !busy;

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border border-border bg-card"
      aria-label={tr("Compose a message")}
    >
      <header className="space-y-1.5 border-b border-border px-3 py-2">
        {mailboxes.length > 1 && (
          <Field label={tr("From")}>
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
          <label htmlFor="composer-to" className="w-10 shrink-0 text-xs text-muted-foreground">{tr("To")}</label>
          <RecipientField
            id="composer-to"
            value={to}
            onChange={(v) => setField("to_address", splitAddresses(v), (() => setTo(v)) as never)}
            extra={recipientExtras}
          />
          {!showCc && (
            <button
              type="button"
              onClick={() => setShowCc(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {tr("Cc")}
            </button>
          )}
        </div>
        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="composer-cc" className="w-10 shrink-0 text-xs text-muted-foreground">{tr("Cc")}</label>
            {/* The same picker as To. Cc is where a colleague gets copied, so
                searching staff from it is the whole point — typing a
                remembered address was the only way before. */}
            <RecipientField
              id="composer-cc"
              value={cc}
              onChange={(v) => setField("cc_address", splitAddresses(v), (() => setCc(v)) as never)}
              extra={recipientExtras}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="composer-subject" className="w-10 shrink-0 text-xs text-muted-foreground">{tr("Subject")}</label>
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

      {/* §8. Everything it produces lands in THIS editor. Nothing is sent, and
          nothing is written to a record. */}
      <div className="px-3 pt-2">
        <AssistToolbar threadId={threadId} getText={getBodyText} setText={setBodyText} />
      </div>

      <AttachmentTray tray={tray} onRemove={detach} onSecureLink={sendAsSecureLink} busy={busy} />

      {/* §9.2. Named, and never a block: the second person can go and ask
          rather than wait out a lock whose end they cannot see. "Continue
          anyway" is not a button because nothing is stopping them. */}
      {heldByOther && (
        <div role="status" className="border-t border-border bg-warning/10 px-3 py-2 text-xs">
          <p>
            {`${heldByOther.locked_by_name || tr("A colleague")} ${tr("started replying to this conversation")}${heldByOther.seconds_remaining ? ` ${tr("a moment ago")}` : ""}. ${tr("You can carry on — this is a heads-up, not a lock on the reply.")}`}
          </p>
        </div>
      )}

      {/* §9.8. The end of "we emailed the invoice three times": the address is
          named, with what is known about it, while there is still somebody to
          ask for a better one. Nothing is disabled — a person may be sending to
          a mailbox they have just been told is fixed. */}
      {(recipients.hard.length > 0 || recipients.soft.length > 0) && (
        <div role="status" className="border-t border-border bg-warning/10 px-3 py-2 text-xs">
          {recipients.hard.map((r) => (
            <p key={r.email}>
              <strong>{r.email}</strong> {tr("has hard-bounced — the mailbox does not exist. Sending again will not reach anyone.")}
            </p>
          ))}
          {recipients.soft.map((r) => (
            <p key={r.email}>
              <strong>{r.email}</strong> {tr("has been failing — mail to it may not arrive.")}
            </p>
          ))}
        </div>
      )}

      {/* Warnings from the SERVER's serializer — the same code that will produce
          the message — so they are about what will actually be sent. */}
      {warnings.length > 0 && (
        <div role="status" className="border-t border-border bg-warning/10 px-3 py-2 text-xs">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
      {/* §8.8. Warnings ride along and refuse nothing; the one hard block asks
          for a reason that goes to the permanent ledger. */}
      {(guardrails?.warnings.length || guardrails?.blocks.length) ? (
        <div className="border-t border-border px-3 py-2">
          <GuardrailBar
            result={guardrails}
            overrideReason={override}
            onOverrideChange={setOverride}
          />
        </div>
      ) : null}

      {error && <div className="px-3 pt-2"><ErrorState message={error} /></div>}
      {slots["composer.presend"]}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button size="sm" onClick={send} disabled={!canSend} loading={busy}>
          {schedule.kind === "NOW" ? tr("Send") : tr("Schedule")}
        </Button>
        <AttachButton onFiles={attach} disabled={busy} />
        <SchedulePicker value={schedule} onChange={setSchedule} />
        {slots["composer.footer.left"]}
        <span className="ml-auto flex items-center gap-2">
          {slots["composer.footer.right"]}
          {savedAt && <Pill tone="mute">{tr("Draft saved")}</Pill>}
          {onClose && <Button size="sm" variant="ghost" onClick={onClose}>{tr("Close")}</Button>}
        </span>
      </footer>

      {/* A SCHEDULED message has no undo window — it has a whole schedule to be
          cancelled within — and the server reports `undo_seconds: 0` for one.
          Drawing a countdown for a message going out on Tuesday would be a
          toast that expires while the message sits in the queue for six days. */}
      {queued && queued.undo_seconds !== 0 && (
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

      {queued && queued.undo_seconds === 0 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status">
          {`${tr("Scheduled for")} ${new Date(queued.release_at).toLocaleString()}. ${tr("You can cancel it from the outbox until then.")}`}
        </div>
      )}
    </section>
  );
}

export default Composer;
