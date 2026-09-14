/** Chat composer: one tools menu, list-aware editing, durable scheduling.
 * Uploads and unsent words are retained until a successful post. Draft writes
 * are serialized so a late autosave cannot resurrect a sent message. */
import * as React from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { useToast } from "@/components/ui/toast";
import { useUpload } from "@/lib/use-upload";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";
import type {
  CommMessage,
  ErpCard,
  PostedAttachment,
  UploadedAttachment,
} from "@/lib/smartcomm-api";
import { VoiceRecorder, type Recording } from "./voice-recorder";
import { ErpCardView } from "./erp-card";
import { ComposerActions } from "./composer-actions";
import { MessageEditor } from "./message-editor";
import { parseMessage } from "./message-format";
import { ScheduledMessages } from "./scheduled-messages";

const ACCEPT =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,application/pdf";

export function Composer({
  channelId,
  replyTo,
  onCancelReply,
  onSent,
  onTyping,
  editingMessage,
  onCancelEdit,
  onEditLast,
  onBusyChange,
}: {
  channelId: string;
  replyTo?: {
    message_id: string;
    body?: string | null;
    sender?: string | null;
  } | null;
  onCancelReply?: () => void;
  onSent: () => void;
  onTyping?: () => void;
  editingMessage?: CommMessage | null;
  onCancelEdit?: () => void;
  onEditLast?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [text, setText] = React.useState("");
  const [editorReset, setEditorReset] = React.useState({ body: "" });
  // User updates stay inside ProseMirror. Only external replacements reset it;
  // echoing a React value back on every key can replay a stale batched update.
  const replaceText = (body: string) => {
    setText(body);
    setEditorReset({ body });
  };
  const [busy, setBusyState] = React.useState(false);
  const setBusy = (next: boolean) => {
    setBusyState(next);
    onBusyChange?.(next);
  };
  const busyRef = React.useRef(false);
  const [records, setRecords] = React.useState<ErpCard[]>([]);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const editorRef = React.useRef<Editor | null>(null);
  const fileOpenRef = React.useRef<(() => void) | null>(null);
  const untouched = React.useRef(true);
  const textRef = React.useRef(text);
  textRef.current = text;
  const savedDraft = React.useRef<string | null>(null);
  const editRef = React.useRef(editingMessage);
  editRef.current = editingMessage;
  const draftTimer = React.useRef<number | null>(null);
  const draftWrites = React.useRef<Promise<unknown>>(Promise.resolve());
  const scheduleRequest = React.useRef<{
    signature: string;
    id: string;
  } | null>(null);
  const [draftReady, setDraftReady] = React.useState(false);

  const upload = useUpload<UploadedAttachment>({
    profile: "photo",
    multiple: true,
    autoStart: true,
    send: (file, { onProgress, signal }) =>
      api.uploadMedia(channelId, file, {}, onProgress, signal),
  });
  function stopDraftTimer() {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
  }
  React.useEffect(() => {
    let alive = true;
    api
      .getChannelDraft(channelId)
      .then((d) => {
        if (!alive) return;
        if (untouched.current && d?.body) {
          if (editRef.current) savedDraft.current = d.body;
          else replaceText(d.body);
        }
      })
      .catch(() => {
        /* @silent:storage — a missing draft must not block chat */
      })
      .finally(() => {
        if (alive) setDraftReady(true);
      });
    return () => {
      alive = false;
      stopDraftTimer();
    };
  }, [channelId]);
  React.useEffect(() => {
    stopDraftTimer();
    if (!draftReady || busy || editingMessage) return;
    draftTimer.current = window.setTimeout(() => {
      draftWrites.current = draftWrites.current
        .then(async () => {
          if (text.trim()) await api.saveChannelDraft(channelId, text);
          else await api.clearChannelDraft(channelId);
        })
        .catch(() => {
          /* @silent:storage — preserve local words if draft persistence is unavailable */
        });
    }, 700);
    return stopDraftTimer;
  }, [text, channelId, draftReady, busy, editingMessage]);
  React.useEffect(() => {
    if (editingMessage) {
      stopDraftTimer();
      if (savedDraft.current === null) savedDraft.current = textRef.current;
      replaceText(editingMessage.body || "");
      requestAnimationFrame(() => editorRef.current?.commands.focus("end"));
    } else if (savedDraft.current !== null) {
      replaceText(savedDraft.current);
      savedDraft.current = null;
      requestAnimationFrame(() => editorRef.current?.commands.focus("end"));
    }
  }, [editingMessage]);

  const uploading = upload.busy;
  const failed = upload.items.filter((i) => i.state === "error");
  const ready = upload.items
    .filter((i) => i.state === "success" && i.result)
    .map((i) => i.result!);
  const canSend =
    !busy &&
    (editingMessage
      ? !!text.trim()
      : !uploading &&
        !failed.length &&
        (!!text.trim() || !!ready.length || !!records.length));
  function attachments(): PostedAttachment[] {
    return [
      ...ready,
      ...records.map((c) => ({
        attachment_kind: "ERP" as const,
        erp_kind: c.kind,
        erp_id: c.id,
        erp_label: c.ref || c.title,
      })),
    ];
  }
  function changeText(value: string) {
    if (!editRef.current) untouched.current = false;
    setText(value);
    scheduleRequest.current = null;
    onTyping?.();
  }
  function insertText(value: string, formatted = false) {
    untouched.current = false;
    if (formatted)
      editorRef.current
        ?.chain()
        .focus()
        .insertContent(parseMessage(value).content || [])
        .run();
    else
      editorRef.current
        ?.chain()
        .focus()
        .insertContent({ type: "text", text: value })
        .run();
  }
  async function clearDraft() {
    stopDraftTimer();
    await draftWrites.current;
    await api.clearChannelDraft(channelId).catch(() => {
      /* @silent:storage — successful send is authoritative */
    });
  }
  async function submit(sendAt?: string, tz?: string): Promise<boolean> {
    if (!canSend || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    stopDraftTimer();
    if (!editingMessage) untouched.current = false;
    try {
      if (editingMessage) {
        if (text.trim() !== editingMessage.body)
          await api.editMessage(editingMessage.message_id, text.trim());
        onCancelEdit?.();
      } else {
        if (sendAt && tz) {
          const payload = {
            body: text.trim(),
            attachments: attachments(),
            reply_to: replyTo?.message_id || null,
            send_at: sendAt,
            timezone: tz,
          };
          const signature = JSON.stringify(payload);
          if (scheduleRequest.current?.signature !== signature)
            scheduleRequest.current = { signature, id: crypto.randomUUID() };
          const result = await api.scheduleMessage(channelId, {
            ...payload,
            request_id: scheduleRequest.current.id,
          });
          if (result.status === "CANCELLED" || result.status === "FAILED")
            throw new Error(
              tr(
                "This scheduling request is no longer pending. Choose a new time to schedule again.",
              ),
            );
          toast.success(
            tr(
              result.status === "SENT"
                ? "Message was already delivered."
                : "Message scheduled.",
            ),
          );
        } else
          await api.postMessage(channelId, text.trim(), {
            attachments: attachments(),
            reply_to: replyTo?.message_id || null,
          });
        await clearDraft();
        replaceText("");
        setRecords([]);
        upload.reset();
        scheduleRequest.current = null;
        onCancelReply?.();
      }
      onSent();
      return true;
    } catch (e) {
      toast.error(
        errMsg(e) ||
          tr("Couldn't send that message. Your draft is still here."),
      );
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function sendVoiceNote(rec: Recording) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const ext = rec.mimeType.includes("mp4")
        ? "m4a"
        : rec.mimeType.includes("ogg")
          ? "ogg"
          : "webm";
      const attachment = await api.uploadMedia(
        channelId,
        new File([rec.blob], `voice-note.${ext}`, { type: rec.mimeType }),
        {
          is_voice_note: true,
          duration_ms: rec.durationMs,
          waveform: rec.waveform,
        },
      );
      await api.postMessage(channelId, "", { attachments: [attachment] });
      onSent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const cancelEdit = () => {
    if (!busyRef.current) onCancelEdit?.();
  };
  return (
    <div className="relative max-h-[50%] shrink-0 overflow-y-auto border-t border-border bg-card">
      {(editingMessage || replyTo) && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
          <span className="min-w-0 flex-1 text-xs">
            <span className="block font-medium text-primary-ink">
              {tr(editingMessage ? "Editing message" : "Replying to")}{" "}
              {!editingMessage && replyTo?.sender}
            </span>
            <span className="block truncate text-muted-foreground">
              {editingMessage?.body || replyTo?.body || tr("Attachment")}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={editingMessage ? cancelEdit : onCancelReply}
          >
            {tr("Cancel")}
          </Button>
        </div>
      )}
      {!editingMessage && (upload.items.length > 0 || records.length > 0) && (
        <div className="space-y-2 border-b border-border px-3 py-2">
          {/* The engine's own list: preview, 0→100%, an explicit complete, a
              retry on failure. Not re-implemented here — that is the whole
              point of the rule. */}
          <UploadList
            items={upload.items}
            onRemove={(id) => {
              if (!busyRef.current) {
                scheduleRequest.current = null;
                upload.remove(id);
              }
            }}
            onRetry={(id) => {
              if (!busyRef.current) upload.retry(id);
            }}
          />
          {records.map((c) => (
            <div key={`${c.kind}:${c.id}`} className="flex items-start gap-2">
              <ErpCardView card={c} className="flex-1" />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setRecords((r) =>
                    r.filter((x) => !(x.kind === c.kind && x.id === c.id)),
                  )
                }
                aria-label={tr("Remove this record")}
                className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          ))}
          {failed.length > 0 && (
            <p className="text-micro text-muted-foreground">
              {tr(
                "Some files didn't upload. Retry them, or remove them to send the rest.",
              )}
            </p>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 px-2 py-2">
        <ComposerActions
          disabled={busy || !!editingMessage}
          onEmoji={(glyph) => insertText(glyph)}
          onFile={() => fileOpenRef.current?.()}
          onRecord={(card) => {
            scheduleRequest.current = null;
            setRecords((r) =>
              r.some((x) => x.kind === card.kind && x.id === card.id)
                ? r
                : [...r, card],
            );
          }}
          onPhrase={(body) => insertText(body, true)}
          onSchedule={() => setScheduleOpen(true)}
        />
        <div className="hidden">
          <FilePicker
            variant="inline"
            openRef={fileOpenRef}
            accept={ACCEPT}
            multiple
            disabled={busy}
            label={tr("Attach a file")}
            onPick={(files) => {
              scheduleRequest.current = null;
              upload.pick(files);
            }}
          />
        </div>
        <MessageEditor
          reset={editorReset}
          onChange={changeText}
          onSend={() => {
            void submit();
          }}
          onEditLast={
            !editingMessage &&
            !ready.length &&
            !records.length &&
            !upload.items.length
              ? onEditLast
              : undefined
          }
          onCancel={editingMessage ? cancelEdit : undefined}
          disabled={busy}
          editorRef={editorRef}
        />
        {editingMessage ||
        text.trim() ||
        ready.length ||
        records.length ||
        uploading ? (
          <Button
            type="button"
            onClick={() => {
              void submit();
            }}
            loading={busy}
            disabled={!canSend}
            size="sm"
            icon={null}
          >
            {tr(editingMessage ? "Save" : uploading ? "Uploading…" : "Send")}
          </Button>
        ) : (
          <VoiceRecorder onRecorded={sendVoiceNote} disabled={busy} />
        )}
      </div>
      <p className="px-14 pb-2 text-[10px] text-muted-foreground">
        {tr("Enter to send · Shift + Enter for a new line")}
      </p>
      <ScheduledMessages
        channelId={channelId}
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        canSchedule={canSend && !editingMessage}
        onSchedule={submit}
        busy={busy}
      />
    </div>
  );
}
