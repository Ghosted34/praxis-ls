/**
 * The message composer.
 *
 * What it can send, and the one rule each obeys:
 *
 *   text      Enter sends, Shift+Enter breaks the line, and the box grows to
 *             about six lines before it scrolls.
 *   emoji     from the self-hosted picker — no CDN request leaves the device.
 *   files     through the upload ENGINE, never a bare <input type="file">.
 *   voice     recorded here, transcribed server-side, sent as one attachment.
 *   records   a live ERP reference, resolved against whoever reads it.
 *
 * ── UPLOADS START ON PICK, THE MESSAGE POSTS ON SEND ──────────────────────
 *
 * `useUpload({ autoStart: true })`: bytes go up while the person is still
 * typing. By the time they press Send there is nothing left to wait for, which
 * is what makes a photo appear WITH the words rather than a second after them.
 * The deferred mode exists for forms that collect metadata after the pick —
 * that is not this.
 *
 * The consequence is that Send has to refuse while an upload is in flight, and
 * it says which: "Uploading…" on the button is a truthful reason the person can
 * act on, where a disabled button with no explanation is not.
 *
 * ── THE DRAFT SURVIVES, AND IT SURVIVES CORRECTLY ─────────────────────────
 *
 * `comms_draft` has existed since 0430 and nothing ever wrote to it. It is
 * written here, debounced, and CLEARED before the post rather than after — the
 * ordering matters, and it is the same defect class the native-dialog ban
 * exists for: an autosave landing after a send would restore the text the
 * person just sent.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { useToast } from "@/components/ui/toast";
import { useUpload } from "@/lib/use-upload";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";
import type { ErpCard, PostedAttachment, UploadedAttachment } from "@/lib/smartcomm-api";
import { VoiceRecorder, type Recording } from "./voice-recorder";
import { ErpPicker } from "./erp-picker";
import { ErpCardView } from "./erp-card";

/**
 * What the file picker offers.
 *
 * Deliberately broad. The point of the vault/chat split on the server is that
 * an operator can put ANY file in front of a colleague — a .dwg, a .p7s, a bank
 * statement — and the routing decides where it lands. Narrowing the picker here
 * would put that decision back on the person, in a dialog, at the wrong moment.
 */
const ACCEPT = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,application/pdf";

/** Roughly six lines before the textarea scrolls instead of growing. */
const MAX_TEXTAREA_PX = 132;

export function Composer({
  channelId,
  replyTo,
  onCancelReply,
  onSent,
  onTyping,
}: {
  channelId: string;
  replyTo?: { message_id: string; body?: string | null; sender?: string | null } | null;
  onCancelReply?: () => void;
  onSent: () => void;
  onTyping?: () => void;
}) {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [records, setRecords] = React.useState<ErpCard[]>([]);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  /**
   * The upload engine. `profile: "photo"` — these are photographs bound for a
   * chat bubble and should look like photographs; the server applies the same
   * profile to what it stores, and `document` (no tonal correction) to anything
   * routed to the vault. See smartcomm.media.service.js.
   */
  const upload = useUpload<UploadedAttachment>({
    profile: "photo",
    multiple: true,
    autoStart: true,
    send: (file, { onProgress, signal }) =>
      api.uploadMedia(channelId, file, {}, onProgress, signal),
  });

  /* ── The draft ─────────────────────────────────────────────────────────── */
  const loadedDraft = React.useRef(false);
  React.useEffect(() => {
    loadedDraft.current = false;
    setText("");
    api
      .getChannelDraft(channelId)
      .then((d) => {
        // Only if the person has not started typing in the meantime — a slow
        // draft read must never overwrite live input.
        if (!loadedDraft.current && d && d.body) setText(d.body);
        loadedDraft.current = true;
      })
      .catch(() => {
        /* @silent:storage — no draft is the normal case, not a failure to report */
        loadedDraft.current = true;
      });
  }, [channelId]);

  React.useEffect(() => {
    if (!loadedDraft.current) return undefined;
    const body = text;
    const timer = window.setTimeout(() => {
      (body.trim() ? api.saveChannelDraft(channelId, body) : api.clearChannelDraft(channelId)).catch(() => {
        /* @silent:storage — a lost draft is a small harm; blocking the composer on it is a larger one */
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [text, channelId]);

  /* ── Growing textarea ──────────────────────────────────────────────────── */
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  function insertEmoji(glyph: string) {
    const el = taRef.current;
    if (!el) { setText((t) => t + glyph); return; }
    // At the CARET, not appended. Somebody who moved back to fix a word and
    // then reached for the picker means it where the cursor is.
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + glyph + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + glyph.length, start + glyph.length);
    });
  }

  /**
   * A finished recording goes up immediately and posts as its own message.
   *
   * Not staged alongside the text: a voice note IS the message. Someone who
   * typed half a sentence and then recorded meant to send the recording, and
   * pinning it to unsent text would lose one or the other.
   */
  async function sendVoiceNote(rec: Recording) {
    if (busy) return;
    setBusy(true);
    try {
      const ext = rec.mimeType.includes("mp4") ? "m4a" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      const file = new File([rec.blob], `voice-note.${ext}`, { type: rec.mimeType });
      const attachment = await api.uploadMedia(channelId, file, {
        is_voice_note: true,
        duration_ms: rec.durationMs,
        waveform: rec.waveform,
      });
      await api.postMessage(channelId, "", { attachments: [attachment] });
      onSent();
    } catch (e) {
      toast.error(errMsg(e) || tr("Couldn't send that voice note."));
    } finally {
      setBusy(false);
    }
  }

  // `upload.busy` is the engine's own answer to "is anything in flight", so
  // the composer does not keep a second, drifting copy of it.
  const uploading = upload.busy;
  const failed = upload.items.filter((i) => i.state === "error");
  const ready = upload.items.filter((i) => i.state === "success" && i.result).map((i) => i.result!);
  const canSend = !busy && !uploading && (text.trim().length > 0 || ready.length > 0 || records.length > 0);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    const body = text.trim();
    const attachments: PostedAttachment[] = [
      ...ready,
      ...records.map((c) => ({
        attachment_kind: "ERP" as const,
        erp_kind: c.kind,
        erp_id: c.id,
        // The sender's caption, stored ONLY as the fallback for a reader who
        // cannot resolve the record. Never a figure.
        erp_label: c.ref || c.title,
      })),
    ];

    setBusy(true);
    // Cleared BEFORE the post, and the local state cleared first, so a
    // debounced autosave in flight cannot resurrect what was just sent.
    setText("");
    setRecords([]);
    upload.reset();
    try {
      await api.clearChannelDraft(channelId).catch(() => {
        /* @silent:storage — a stale draft row is harmless; the message matters */
      });
      await api.postMessage(channelId, body, {
        attachments,
        reply_to: replyTo?.message_id || null,
      });
      onCancelReply?.();
      onSent();
    } catch (err) {
      // Put the words back. Losing a typed message to a dropped connection is
      // the one failure people do not forgive.
      setText(body);
      setRecords(records);
      toast.error(errMsg(err) || tr("Couldn't send that message."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border">
      {replyTo && (
        <div className="flex items-start gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
          <span aria-hidden className="mt-0.5 text-muted-foreground">↩</span>
          <span className="min-w-0 flex-1">
            <span className="block text-micro font-medium text-primary-ink">
              {tr("Replying to")} {replyTo.sender || tr("a message")}
            </span>
            <span className="block truncate text-micro text-muted-foreground">
              {replyTo.body || tr("(attachment)")}
            </span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label={tr("Cancel reply")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {(upload.items.length > 0 || records.length > 0) && (
        <div className="space-y-2 border-b border-border px-3 py-2">
          {/* The engine's own list: preview, 0→100%, an explicit complete, a
              retry on failure. Not re-implemented here — that is the whole
              point of the rule. */}
          <UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
          {records.map((c) => (
            <div key={`${c.kind}:${c.id}`} className="flex items-start gap-2">
              <ErpCardView card={c} className="flex-1" />
              <button
                type="button"
                onClick={() => setRecords((r) => r.filter((x) => !(x.kind === c.kind && x.id === c.id)))}
                aria-label={tr("Remove this record")}
                className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          ))}
          {failed.length > 0 && (
            <p className="text-micro text-muted-foreground">
              {tr("Some files didn't upload. Retry them, or remove them to send the rest.")}
            </p>
          )}
        </div>
      )}

      <form className="flex items-end gap-1 px-2 py-2" onSubmit={send}>
        <EmojiPicker onPick={insertEmoji} disabled={busy} />

        <FilePicker
          variant="inline"
          accept={ACCEPT}
          multiple
          disabled={busy}
          label={tr("Attach a file")}
          onPick={upload.pick}
          trigger={
            <span
              className="grid h-9 w-9 place-items-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              title={tr("Attach a file")}
            >
              📎
            </span>
          }
        />

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          aria-label={tr("Attach a record")}
          title={tr("Attach a record")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
        >
          🧾
        </button>

        <textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => { setText(e.target.value); onTyping?.(); }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter breaks. The IME check is not optional:
            // during composition Enter COMMITS the candidate, and sending on it
            // cuts every Japanese or Chinese message off mid-word.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={tr("Write a message…")}
          aria-label={tr("Write a message")}
          className={cn(
            "flex-1 resize-none rounded-2xl border border-input bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />

        {/* The recorder replaces Send while it is running, which is what makes
            the row legible on a phone: there is one primary action at a time. */}
        {text.trim() || ready.length || records.length ? (
          <Button type="submit" loading={busy} disabled={!canSend} size="sm" icon={null}>
            {uploading ? tr("Uploading…") : tr("Send")}
          </Button>
        ) : (
          <VoiceRecorder onRecorded={sendVoiceNote} disabled={busy} />
        )}
      </form>

      <ErpPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(card) =>
          setRecords((r) =>
            r.some((x) => x.kind === card.kind && x.id === card.id) ? r : [...r, card],
          )
        }
      />
    </div>
  );
}
