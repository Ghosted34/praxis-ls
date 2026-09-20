/**
 * What an attachment looks like inside a bubble.
 *
 * Four shapes, because four things are genuinely different to a reader:
 *
 *   IMAGE     shown, at its own aspect ratio, openable full size
 *   VIDEO     a player, controls, nothing auto-playing
 *   VOICE     its own file — see voice-note.tsx
 *   document  a row: icon, name, size, download. A PDF is not a picture and
 *             pretending otherwise costs the reader the filename, which is
 *             usually the only way they know which of three scans this is
 *   ERP       a live record card — see erp-card.tsx
 *
 * ── THE BOX IS RESERVED BEFORE THE BYTES ARRIVE ───────────────────────────
 *
 * `width`/`height` are stored on upload precisely so this can set an
 * `aspect-ratio` before the image loads. Without them every incoming photo
 * reflows the thread as it decodes and throws away the reader's scroll
 * position — which in a conversation means losing the message you were reading.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import * as api from "@/lib/smartcomm-api";
import { downloadVaultDoc } from "@/lib/vault-file";
import type { CommAttachment } from "@/lib/smartcomm-api";
import { useObjectUrl, useNearViewport } from "./use-object-url";
import { VoiceNote, type BubbleTone } from "./voice-note";
import { ErpCardView } from "./erp-card";
import { CallSummaryCardView } from "../call/call-summary-card";

/**
 * Bytes, in the units a person reads.
 *
 * Module-private: nothing outside this file needs it, and exporting a plain
 * function beside a component breaks Fast Refresh. `use-upload.ts` keeps its
 * own private copy for the size-limit message — one shared formatter would be
 * tidier, but that one is load-bearing in a user-facing sentence and moving it
 * is not this change's business.
 */
function humanSize(bytes?: number | null): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileGlyph({ contentType }: { contentType?: string | null }) {
  const t = String(contentType || "");
  const glyph = t.includes("pdf")
    ? "📕"
    : /sheet|excel|csv/.test(t)
      ? "📗"
      : /word|document/.test(t)
        ? "📘"
        : /zip|compress/.test(t)
          ? "🗜️"
          : "📄";
  return <span aria-hidden className="text-xl leading-none">{glyph}</span>;
}

/** An image in a bubble, fetched when it comes near the viewport. */
function ImageAttachment({
  attachment,
  onOpen,
}: {
  attachment: CommAttachment;
  onOpen: (url: string) => void;
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const mediaId = attachment.media_id || "";
  const fetcher = React.useMemo(
    () => (mediaId ? (signal: AbortSignal) => api.mediaObjectUrl(mediaId, signal) : null),
    [mediaId],
  );
  const { url, loading, error } = useObjectUrl(fetcher, { enabled: near });

  // Reserve the real box where we know it. Clamped so a tall portrait photo
  // does not push the rest of the conversation off the screen.
  const ratio =
    attachment.width && attachment.height
      ? `${attachment.width} / ${attachment.height}`
      : "4 / 3";

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg border border-border bg-muted"
      style={{ aspectRatio: ratio, maxWidth: 320, maxHeight: 380 }}
    >
      {url ? (
        <button
          type="button"
          onClick={() => onOpen(url)}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={tr("Open image full size")}
        >
          <img
            src={url}
            alt={attachment.original_name || attachment.filename || tr("Attached image")}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <div className="grid h-full w-full place-items-center text-micro text-muted-foreground">
          {error ? tr("Couldn't load") : loading || near ? tr("Loading…") : ""}
        </div>
      )}
    </div>
  );
}

function VideoAttachment({ attachment }: { attachment: CommAttachment }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const mediaId = attachment.media_id || "";
  const fetcher = React.useMemo(
    () => (mediaId ? (signal: AbortSignal) => api.mediaObjectUrl(mediaId, signal) : null),
    [mediaId],
  );
  const { url, error } = useObjectUrl(fetcher, { enabled: near });

  return (
    <div ref={ref} className="overflow-hidden rounded-lg border border-border bg-muted" style={{ maxWidth: 320 }}>
      {url ? (
        // No autoplay and no loop: a thread where three videos start talking
        // over each other on scroll is the reason every messaging app stopped
        // doing it.
        <video src={url} controls preload="metadata" className="w-full" />
      ) : (
        <div className="grid h-40 place-items-center text-micro text-muted-foreground">
          {error ? tr("Couldn't load") : tr("Loading…")}
        </div>
      )}
    </div>
  );
}

/**
 * A document row.
 *
 * Downloads through the same gated read as everything else, which is why it is
 * a button rather than an anchor: an `href` cannot carry the token.
 */
function DocumentAttachment({ attachment }: { attachment: CommAttachment }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const name = attachment.original_name || attachment.filename || tr("Attachment");

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      if (attachment.attachment_kind === "MEDIA" && attachment.media_id) {
        const url = await api.mediaObjectUrl(attachment.media_id);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else if (attachment.vault_id) {
        // The vault has its own gated download, with its own not-rendered-yet and
        // no-longer-there messages. Reusing it keeps one answer to "the file
        // is missing" rather than two that disagree.
        await downloadVaultDoc(attachment.vault_id, name);
      }
    } catch {
      toast.error(tr("Couldn't download that file."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="flex w-full max-w-[320px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
    >
      <FileGlyph contentType={attachment.content_type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        <span className="block text-micro text-muted-foreground">
          {busy ? tr("Downloading…") : humanSize(attachment.size_bytes) || tr("Document")}
        </span>
      </span>
      <span aria-hidden className="text-muted-foreground">↓</span>
    </button>
  );
}

/**
 * Every attachment on one message.
 *
 * `onPromote` is only offered for chat MEDIA that is not already in the vault:
 * a document went there on upload and has nowhere to be promoted to. See the
 * split in smartcomm.media.service.js.
 */
export function Attachments({
  attachments,
  onPromote,
  tone = "surface",
}: {
  attachments: CommAttachment[];
  onPromote?: (attachment: CommAttachment) => void;
  /**
   * The ground the BUBBLE painted, passed down rather than guessed.
   *
   * The sender's own messages are drawn on `bg-primary`, and a child that
   * reaches for `--muted-foreground` there is drawing secondary text on the
   * brand fill: 2.39:1 in light, 1.01:1 in dark. Nothing inside a component
   * can see the ground its parent painted, which is exactly how that shipped —
   * so the parent says. See `BubbleTone` in voice-note.tsx.
   */
  tone?: BubbleTone;
}) {
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  if (!attachments.length) return null;

  return (
    <div className="space-y-1.5">
      {attachments.map((a, i) => {
        const key = a.attachment_id || `${a.attachment_kind}-${i}`;
        if (a.attachment_kind === "ERP") {
          return <ErpCardView key={key} card={a.erp_card || null} label={a.erp_label} />;
        }
        if (a.attachment_kind === "CALL") {
          // A posted call summary (PR-2). Resolved live on the thread read, so a
          // draft regenerated in the other language reads in that language here
          // too, and the transcript link beside it always agrees with the card.
          return <CallSummaryCardView key={key} card={a.call_card || null} callId={a.call_id} />;
        }
        if (a.attachment_kind === "MEDIA" && a.is_voice_note) {
          return <VoiceNote key={key} attachment={a} tone={tone} />;
        }
        if (a.attachment_kind === "MEDIA" && a.media_kind === "IMAGE") {
          return (
            <div key={key} className="space-y-1">
              <ImageAttachment attachment={a} onOpen={setLightbox} />
              {onPromote && !a.promoted_vault_id && (
                <button
                  type="button"
                  onClick={() => onPromote(a)}
                  className={
                    tone === "primary"
                      ? "text-micro text-primary-foreground underline-offset-2 hover:underline"
                      : "text-micro text-primary-ink underline-offset-2 hover:underline"
                  }
                >
                  {tr("Save to vault")}
                </button>
              )}
              {a.promoted_vault_id && (
                <span
                  className={
                    tone === "primary"
                      ? "block text-micro text-primary-foreground/80"
                      : "block text-micro text-muted-foreground"
                  }
                >
                  {tr("Saved to the vault")}
                </span>
              )}
            </div>
          );
        }
        if (a.attachment_kind === "MEDIA" && a.media_kind === "VIDEO") {
          return <VideoAttachment key={key} attachment={a} />;
        }
        return <DocumentAttachment key={key} attachment={a} />;
      })}

      {lightbox && (
        <Dialog open onClose={() => setLightbox(null)} title={tr("Image")} size="wide" bodyClassName="p-0">
          <img src={lightbox} alt={tr("Attached image, full size")} className="max-h-[75vh] w-full object-contain" />
        </Dialog>
      )}
    </div>
  );
}
