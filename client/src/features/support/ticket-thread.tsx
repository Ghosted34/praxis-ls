/**
 * The ticket thread — the conversation, on both sides of it.
 *
 * This is the screen the revamp exists for: before it, a ticket's whole
 * history was a status pill, and the answer Praxis gave ("clear your cache,
 * then export again") had nowhere to live. Now the original, every reply and
 * every screenshot sit in one place, the way the Q-tickets thread does for
 * client queries against a milestone — same shape, other channel.
 *
 * INTERNAL NOTES DO NOT EXIST HERE. The strip is server-side: the tenant API
 * never returns an internal reply (support.service.js filters it in the SQL),
 * so there is nothing this file can accidentally show. What Praxis writes as
 * internal reaches the tenant the way an internal Q-reply would: never.
 *
 * REPLIES RERENDER MARKDOWN because that is how Praxis writes guidance —
 * numbered steps, bolded button names, code for an export name. Plain text
 * survives the renderer unchanged, so the tenant's own replies read as
 * written. One renderer, both directions (components/markdown.tsx).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { Markdown } from "@/components/markdown";
import { ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useResource } from "@/lib/use-resource";
import { dateTimeFmt } from "@/lib/format";
import { useUpload } from "@/lib/use-upload";
import {
  getTicket,
  postReply,
  uploadTicketImage,
  ticketAttachmentUrl,
  KIND_LABEL,
  KIND_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type TicketAttachment,
  type TicketReply,
} from "./support-api";

const MAX_REPLY_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * One attached image. Bytes come through the scoped read (Bearer → object
 * URL), never the public /media mount — the same rule as smartcomm's chat
 * media. The URL is revoked on unmount and when it is replaced.
 */
function AttachmentImage({ att }: { att: TicketAttachment }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const ctrl = new AbortController();
    setUrl(null);
    setFailed(false);
    ticketAttachmentUrl(att.attachment_id, ctrl.signal)
      .then((u) => setUrl(u))
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true);
      });
    return () => ctrl.abort();
  }, [att.attachment_id]);

  React.useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  if (failed) return null;
  if (!url) {
    return (
      <div
        className="h-32 w-32 animate-pulse rounded-lg border border-border bg-muted"
        aria-label={tr("Loading image")}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => window.open(url, "_blank", "noopener")}
      className="block rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${tr("Open image")} — ${att.file_name}`}
      title={att.file_name}
    >
      <img
        src={url}
        alt={att.file_name}
        className="h-32 w-32 rounded-lg object-cover"
      />
    </button>
  );
}

function AttachmentRow({ atts }: { atts: TicketAttachment[] }) {
  if (!atts || !atts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {atts.map((a) => (
        <AttachmentImage key={a.attachment_id} att={a} />
      ))}
    </div>
  );
}

function ReplyCard({ reply, isOwn }: { reply: TicketReply; isOwn: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="micro mb-1 flex items-center gap-2">
        {reply.author_side === "PRAXIS" ? "Praxis team" : isOwn ? tr("You") : "Your team"}
        <span className="ml-auto">{dateTimeFmt(reply.created_at)}</span>
      </p>
      <div className="text-sm text-foreground">
        <Markdown text={reply.body} />
      </div>
      <AttachmentRow atts={reply.attachments} />
    </div>
  );
}

export function TicketThreadModal({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const data = useResource(() => getTicket(ticketId), [ticketId]);
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const upload = useUpload<TicketAttachment>({
    profile: "document",
    multiple: true,
    maxBytes: MAX_IMAGE_BYTES,
    send: uploadTicketImage,
  });

  const cappedPick = React.useCallback(
    (files: FileList | null) => {
      const room = MAX_REPLY_IMAGES - upload.items.length;
      if (room <= 0) return;
      const list = Array.from(files || []);
      void upload.pick(list.slice(0, room));
    },
    [upload],
  );

  const attachmentIds = upload.items
    .filter((it) => it.state === "success" && it.result?.attachment_id)
    .map((it) => it.result!.attachment_id);
  const uploading = upload.items.some(
    (it) => it.state === "compressing" || it.state === "uploading",
  );

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await postReply(ticketId, { body: body.trim(), attachmentIds });
      setBody("");
      upload.reset();
      data.reload();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const t = data.data;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t?.title || tr("Ticket")}
      description={
        t
          ? `${KIND_LABEL[t.kind] || t.kind} · ${
              STATUS_LABEL[t.status] || t.status
            } · ${dateTimeFmt(t.created_at)}`
          : undefined
      }
      headerRight={
        t ? (
          <div className="flex gap-2">
            <Pill tone={KIND_TONE[t.kind] || "mute"}>
              {KIND_LABEL[t.kind] || t.kind}
            </Pill>
            <Pill tone={STATUS_TONE[t.status] || "mute"}>
              {STATUS_LABEL[t.status] || t.status}
            </Pill>
          </div>
        ) : null
      }
      footer={
        <Button onClick={send} loading={busy} disabled={busy || !body.trim() || uploading}>
          {tr("Send reply")}
        </Button>
      }
    >
      {data.error ? (
        <ErrorState message={data.error} />
      ) : !t ? (
        <SkeletonTable rows={3} cols={1} />
      ) : (
        <div className="space-y-3">
          {t.body ? (
            <div className="rounded-lg border border-border p-3">
              <p className="micro mb-1">{tr("You")}</p>
              <div className="text-sm text-foreground">
                <Markdown text={t.body} />
              </div>
              <AttachmentRow atts={t.attachments || []} />
            </div>
          ) : null}

          {t.replies && t.replies.length > 0 ? (
            t.replies.map((r) => (
              <ReplyCard key={r.reply_id} reply={r} isOwn={r.author_side === "TENANT"} />
            ))
          ) : (
            <p className="micro text-muted-foreground">
              {tr("No replies yet. When the Praxis team answers, it appears here — and in your notifications.")}
            </p>
          )}

          <Field label={tr("Reply")}>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder={tr("Add any detail that would help…")}
              maxLength={5000}
            />
          </Field>
          <FilePicker
            onPick={cappedPick}
            accept="image/png,image/jpeg,image/webp,image/gif"
            label={tr("Screenshots (optional)")}
            hint={tr("Show the Praxis team what you are seeing.")}
            multiple
            disabled={upload.items.length >= MAX_REPLY_IMAGES}
          />
          <UploadList
            items={upload.items}
            onRemove={upload.remove}
            onRetry={upload.retry}
          />
          {error && <ErrorState message={error} />}
        </div>
      )}
    </Modal>
  );
}
