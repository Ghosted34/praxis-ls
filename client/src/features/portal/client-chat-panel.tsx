/**
 * The team's side of a client's portal chat (14170): General and one thread
 * per shipment, with the photos, PDFs, voice notes and locations the client
 * sends — and a reply box that can carry a file back.
 *
 * Opening a thread marks the client's messages in it read, which is the
 * "seen" tick on their phone; answering does the same. The same panel serves
 * Settings › Client support, the Client inbox (Comms › Clients) and a
 * client's Messages tab (client portal PR 3).
 *
 * The reply box is the Smart Comms team chat's: a `+` with the tools (photo or
 * document, location, emoji, quick replies — client-chat-tools.tsx), Enter to
 * send, a file pasted straight into the box, and a microphone for a voice note
 * while there is nothing to send.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { tr } from "@/lib/i18n";
import { tenant, tenantObjectUrl, tenantDownload, uploadFile } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { useUpload } from "@/lib/use-upload";
import { dateTimeFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SendIcon } from "@/components/ui/icons";
import { Chips } from "@/components/ui/chips";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { pasteFileFromEvent } from "@/components/ui/upload-paste";
import { useToast } from "@/components/ui/toast";
import { useCanUseModule } from "@/lib/route-access";
import { VoiceRecorder, type Recording } from "@/features/comms/chat/voice-recorder";
import { ClientChatTools, ShareLocationDialog, type SharedPlace } from "./client-chat-tools";

type Attachment = {
  attachment_id: string;
  kind: "IMAGE" | "FILE" | "VOICE";
  name: string | null;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};
type Message = {
  message_id: string;
  direction: "STAFF" | "CLIENT";
  body: string;
  created_at: string;
  author: { name: string | null; email: string | null };
  seen: boolean | null;
  milestone: { milestone_instance_id: string; label: string | null } | null;
  location: { lat: number; lng: number; label: string | null } | null;
  attachments: Attachment[];
};
type Page = { thread: string; dossier_ref: string | null; has_more: boolean; messages: Message[] };
type Thread = { dossier_id: string | null; dossier_ref: string | null; last_at: string; unread: number };

const POLL_MS = 15_000;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

/** A photo from the chat — fetched with the session, since an <img> cannot send it. */
function ChatPhoto({ att }: { att: Attachment }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const ctl = new AbortController();
    let made: string | null = null;
    tenantObjectUrl(`/portal/chat/attachments/${att.attachment_id}?size=preview`, ctl.signal)
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => {
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [att.attachment_id]);
  const ratio = att.width && att.height ? Math.min(Math.max(att.width / att.height, 0.66), 1.8) : 4 / 3;
  return (
    <button
      type="button"
      className="block w-64 max-w-full overflow-hidden rounded-lg bg-muted"
      style={{ aspectRatio: String(ratio) }}
      title={tr("Download the original")}
      onClick={() => void tenantDownload(`/portal/chat/attachments/${att.attachment_id}`, att.name || "photo.jpg")}
    >
      {url ? (
        <img src={url} alt={att.name || ""} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-xs text-muted-foreground">
          {failed ? tr("Photo unavailable") : "…"}
        </span>
      )}
    </button>
  );
}

/** A voice note: fetched when first played, not when the thread opens. */
function ChatVoice({ att }: { att: Attachment }) {
  const toast = useToast();
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <audio controls autoPlay src={url} className="h-10 w-64 max-w-full" />;
  const secs = Math.round((att.duration_ms || 0) / 1000);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        tenantObjectUrl(`/portal/chat/attachments/${att.attachment_id}`)
          .then(setUrl)
          .catch((e) => toast.error(errMsg(e)))
      }
    >
      {`▶ ${tr("Voice note")}${secs ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}`}
    </Button>
  );
}

function Bubble({ m }: { m: Message }) {
  const ours = m.direction === "STAFF";
  const who = ours ? m.author.name || tr("Team") : m.author.email || tr("Client");
  return (
    <li className={cn("flex", ours ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm",
          ours ? "rounded-br-md bg-primary/10 text-foreground" : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        <p className="mb-0.5 text-xs font-semibold text-primary-ink">{who}</p>
        {m.milestone?.label ? (
          <p className="mb-1">
            <Pill tone="blue">{m.milestone.label}</Pill>
          </p>
        ) : null}
        {m.attachments.map((a) => (
          <div key={a.attachment_id} className="mb-1">
            {a.kind === "IMAGE" ? (
              <ChatPhoto att={a} />
            ) : a.kind === "VOICE" ? (
              <ChatVoice att={a} />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void tenantDownload(`/portal/chat/attachments/${a.attachment_id}`, a.name || "document.pdf")}
              >
                {a.name || tr("Document")}
              </Button>
            )}
          </div>
        ))}
        {m.location ? (
          <a
            className="mb-1 block text-primary-ink underline"
            href={`https://www.google.com/maps/search/?api=1&query=${m.location.lat},${m.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.location.label || tr("Location")} ({m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)})
          </a>
        ) : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        <p className="mt-0.5 text-right text-[11px] text-muted-foreground">{dateTimeFmt(m.created_at)}</p>
      </div>
    </li>
  );
}

export function ClientChatPanel({
  clientId,
  initialThread = "general",
  onActivity,
}: {
  clientId: string;
  initialThread?: string;
  /** A thread was read or answered here — the Client inbox refreshes its counts. */
  onActivity?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [thread, setThread] = React.useState(initialThread);
  const [page, setPage] = React.useState<Page | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [placing, setPlacing] = React.useState(false);
  const [pasteNote, setPasteNote] = React.useState<string | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const fileOpen = React.useRef<(() => void) | null>(null);
  // A ref as well as the state: two quick Enters land before `busy` re-renders.
  const sending = React.useRef(false);
  // Quick replies are Smart Comms' (MOD-64); the tools offer them to its holders.
  const phrasesOn = useCanUseModule("MOD-64");
  // Held in a ref: a parent passing an inline arrow must not change `load`'s
  // identity on every render — that would restart the poll, re-read, notify
  // the parent, re-render it, and go round again.
  const activity = React.useRef(onActivity);
  activity.current = onActivity;

  const q = `client_id=${encodeURIComponent(clientId)}`;

  const loadThreads = React.useCallback(() => {
    tenant<Thread[]>(`/portal/chat/threads?${q}`)
      .then(setThreads)
      .catch((e) => setError(errMsg(e)));
  }, [q]);

  const load = React.useCallback(
    async (markRead: boolean) => {
      try {
        const p = await tenant<Page>(`/portal/chat/messages?${q}&thread=${encodeURIComponent(thread)}`);
        setPage(p);
        setError(null);
        // Reading the thread is what the client sees as "seen".
        if (markRead && p.messages.some((m) => m.direction === "CLIENT")) {
          await tenant(`/portal/chat/read`, { method: "POST", body: { client_id: clientId, thread } });
          loadThreads();
          activity.current?.();
        }
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [q, thread, clientId, loadThreads],
  );

  React.useEffect(() => {
    setPage(null);
    loadThreads();
    void load(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, loadThreads]);

  const count = page?.messages.length || 0;
  React.useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count, thread]);

  /**
   * Deferred, like the vault upload: the reply text travels with the file in
   * one request, so the file waits for Send. The preview and the compression
   * happen the moment it is picked.
   */
  const upload = useUpload<Message>({
    profile: "document",
    autoStart: false,
    maxBytes: 10 * 1024 * 1024,
    send: (file, ctx) =>
      uploadFile<Message>("/tenant/portal/chat/messages", file, {
        fields: { client_id: clientId, thread, body: draft.trim() || undefined },
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
  });

  /** After anything is sent: the thread, the thread list, and whoever is listening. */
  async function sent() {
    await load(false);
    loadThreads();
    activity.current?.();
  }

  async function send() {
    const body = draft.trim();
    const withFile = upload.items.length > 0;
    if (sending.current || (!body && !withFile)) return;
    sending.current = true;
    setBusy(true);
    try {
      if (withFile) {
        const { ok } = await upload.start();
        if (!ok) return;
        upload.reset();
      } else {
        await tenant("/portal/chat/messages", { method: "POST", body: { client_id: clientId, thread, body } });
      }
      setDraft("");
      setPasteNote(null);
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** A voice note goes the moment the recording stops, as in the team chat. */
  async function sendVoice(rec: Recording) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const ext = rec.mimeType.includes("mp4") ? "m4a" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      await uploadFile<Message>(
        "/tenant/portal/chat/messages",
        new File([rec.blob], `voice-note.${ext}`, { type: rec.mimeType }),
        { fields: { client_id: clientId, thread, duration_ms: Math.round(rec.durationMs) } },
      );
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function sendPlace(place: SharedPlace) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await tenant("/portal/chat/messages", {
        method: "POST",
        body: { client_id: clientId, thread, lat: place.lat, lng: place.lng, location_label: place.label || undefined },
      });
      setPlacing(false);
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** Put text where the cursor is — an emoji, or a quick reply. */
  function insert(text: string) {
    const el = box.current;
    const at = el ? el.selectionStart ?? draft.length : draft.length;
    const to = el ? el.selectionEnd ?? at : at;
    const next = draft.slice(0, at) + text + draft.slice(to);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
  }

  const options = [
    { value: "general", label: tr("General"), count: threads.find((t) => !t.dossier_id)?.unread || undefined },
    ...threads
      .filter((t) => t.dossier_id)
      .map((t) => ({ value: t.dossier_id as string, label: t.dossier_ref || tr("Shipment"), count: t.unread || undefined })),
  ];

  return (
    <div className="grid gap-3">
      <Chips label={tr("Conversation")} value={thread} options={options} onChange={setThread} />
      <div className="max-h-[480px] min-h-[200px] overflow-y-auto rounded-xl border bg-card p-3">
        {error && !page ? (
          <ErrorState message={error} />
        ) : !page ? (
          <SkeletonTable />
        ) : !page.messages.length ? (
          <EmptyState title={t("support.noMessages")} hint={t("support.noMessagesHint")} />
        ) : (
          <ul className="grid gap-2">
            {page.messages.map((m) => (
              <Bubble key={m.message_id} m={m} />
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>
      <div data-composer className="rounded-xl border bg-card">
        {upload.items.length ? (
          <div className="border-b border-border px-3 py-2">
            <UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
          </div>
        ) : null}
        <div className="flex items-end gap-2 px-2 py-2">
          <ClientChatTools
            disabled={busy}
            onFile={() => {
              setPasteNote(null);
              fileOpen.current?.();
            }}
            onLocation={() => setPlacing(true)}
            onEmoji={insert}
            onPhrase={insert}
            phrases={phrasesOn}
          />
          {/* The engine's picker, opened from the + menu — preview, percentage
              and compression all still come from it. */}
          <div className="hidden">
            <FilePicker
              variant="inline"
              openRef={fileOpen}
              accept={ACCEPT}
              onPaste={false}
              label={tr("Photo or document")}
              disabled={busy}
              onPick={(files) => void upload.pick(files)}
            />
          </div>
          <div
            className="min-w-0 flex-1"
            onPaste={(e) => {
              if (busy) return;
              const result = pasteFileFromEvent(e, ACCEPT);
              if (result.kind === "accepted") {
                e.preventDefault();
                setPasteNote(null);
                void upload.pick([result.file]);
              } else if (result.kind === "rejected") {
                e.preventDefault();
                setPasteNote(tr("That file type isn't accepted here — choose a file instead."));
              }
            }}
          >
            <Textarea
              ref={box}
              rows={1}
              className="max-h-40 min-h-[40px] resize-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={t("support.replyPlaceholder")}
              aria-label={t("support.replyPlaceholder")}
              // Read-only while sending, not disabled: disabling drops focus,
              // and the next line should be typed without reaching for the box.
              readOnly={busy}
            />
          </div>
          {draft.trim() || upload.items.length ? (
            <Button onClick={() => void send()} loading={busy} icon={<SendIcon />}>
              {t("support.sendReply")}
            </Button>
          ) : (
            <VoiceRecorder onRecorded={(rec) => void sendVoice(rec)} disabled={busy} />
          )}
        </div>
        <p
          className={cn("px-14 pb-2 text-[10px]", pasteNote ? "text-[rgb(var(--bad))]" : "text-muted-foreground")}
          role={pasteNote ? "status" : undefined}
        >
          {pasteNote || tr("Enter to send · Shift + Enter for a new line")}
        </p>
      </div>
      <ShareLocationDialog open={placing} onClose={() => setPlacing(false)} onSend={(p) => void sendPlace(p)} busy={busy} />
    </div>
  );
}
