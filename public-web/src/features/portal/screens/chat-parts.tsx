/**
 * What rides in a conversation: the bubble, and inside it a photo, a PDF, a
 * voice note or a pin — plus the day marker and the photo viewer.
 *
 * Drawn the way the person's own messaging app draws them, because that is
 * the grammar they already read without thinking: their words on the right in
 * their tint, the team's on the left, the time small in the corner, one tick
 * when it is sent and two when the team has read it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { portalChatAttachmentDownload, type ChatAttachment, type ChatMessage } from "@/lib/portal-api";
import { cn } from "@/lib/cn";
import { Avatar, Busy, Sheet, Shimmer, errorText, useToast } from "../ui/kit";
import { DocIcon, PinIcon, PlayIcon, PauseIcon, CheckIcon, DoubleCheckIcon, ClockIcon, ImageIcon, DownloadIcon } from "../ui/icons";
import { timeOf } from "../lib/when";
import { formatBytes } from "../ui/upload";
import { useAttachmentUrl, attachmentUrl, clock, mapsUrl } from "../lib/chat-media";

/* ── a photo ─────────────────────────────────────────────────────────────── */

/**
 * The 1024px copy, in a box already the photo's shape — so the thread does not
 * jump as each one arrives. Portrait and panorama are clamped to a shape a
 * bubble can hold.
 */
export function PhotoTile({ att, onOpen, localUrl }: { att: ChatAttachment; onOpen?: (a: ChatAttachment) => void; localUrl?: string | null }) {
  const { t } = useTranslation();
  const remote = useAttachmentUrl(att.attachment_id || null, true, !localUrl);
  const url = localUrl || remote;
  const ratio = att.width && att.height ? Math.min(Math.max(att.width / att.height, 0.66), 1.8) : 4 / 3;
  return (
    <button
      type="button"
      className="pt-chat-photo"
      style={{ aspectRatio: String(ratio) }}
      aria-label={t("portal.chat.viewPhoto")}
      onClick={() => onOpen?.(att)}
      disabled={!onOpen}
    >
      {url && url !== "error" ? (
        <img src={url} alt="" draggable={false} />
      ) : url === "error" ? (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          <ImageIcon size={28} />
        </span>
      ) : (
        <Shimmer className="h-full w-full !rounded-none" />
      )}
    </button>
  );
}

/** The photo, large, with the original one tap away. */
export function PhotoViewer({ att, onClose }: { att: ChatAttachment | null; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const url = useAttachmentUrl(att ? att.attachment_id : null, true, !!att);
  const [busy, setBusy] = React.useState(false);
  async function original() {
    if (!att) return;
    setBusy(true);
    try {
      await portalChatAttachmentDownload(att.attachment_id, att.name || "photo.jpg");
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={!!att}
      onClose={onClose}
      title={t("portal.chat.photo")}
      full
      wide
      footer={
        <button type="button" className="pt-btn pt-btn-outline pt-btn-block" onClick={() => void original()} disabled={busy}>
          <Busy busy={busy}>
            <DownloadIcon size={20} />
          </Busy>
          {t("portal.chat.downloadOriginal")}
        </button>
      }
    >
      <div className="grid h-full min-h-[50vh] place-items-center">
        {url && url !== "error" ? <img src={url} alt="" className="max-h-[70vh] w-auto max-w-full rounded-[14px] object-contain" /> : <Shimmer className="h-[50vh] w-full" />}
      </div>
    </Sheet>
  );
}

/* ── a PDF ───────────────────────────────────────────────────────────────── */

export function FileCard({ att, mine }: { att: ChatAttachment; mine: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const name = att.name || t("portal.chat.kind.FILE");
  async function get() {
    if (!att.attachment_id) return;
    setBusy(true);
    try {
      await portalChatAttachmentDownload(att.attachment_id, att.name || "document.pdf");
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="pt-chat-file" data-mine={mine || undefined} onClick={() => void get()} disabled={busy || !att.attachment_id} aria-label={t("portal.chat.download", { name })}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-[var(--pt-surface)] text-primary-ink">
        <Busy busy={busy}>
          <DocIcon size={22} />
        </Busy>
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="pt-num block text-xs uppercase text-muted-foreground">{att.size ? formatBytes(att.size) : t("portal.common.pdf")}</span>
      </span>
    </button>
  );
}

/* ── a voice note ────────────────────────────────────────────────────────── */

/** Bar heights from the attachment's id: the same note always draws the same shape. */
function bars(seed: string, n = 32): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    // A voice rises and falls; a sine envelope keeps it from looking like noise.
    out.push(0.25 + 0.75 * (0.5 * r + 0.5 * Math.abs(Math.sin((i / n) * Math.PI * 2.3 + r))));
  }
  return out;
}

/**
 * Play, a waveform that fills as it plays (tap it to seek), and the length.
 * The bytes are fetched on the first play, not when the bubble scrolls past —
 * a thread with thirty voice notes costs nothing until one is played.
 */
export function VoicePlayer({ att, mine, localUrl }: { att: ChatAttachment; mine: boolean; localUrl?: string | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [pos, setPos] = React.useState(0);
  const [length, setLength] = React.useState(att.duration_ms || 0);
  const shape = React.useMemo(() => bars(att.attachment_id || att.name || "voice"), [att.attachment_id, att.name]);

  async function ensureSource(): Promise<boolean> {
    const el = audio.current;
    if (!el) return false;
    if (el.src) return true;
    if (localUrl) {
      el.src = localUrl;
      return true;
    }
    setLoading(true);
    try {
      el.src = await attachmentUrl(att.attachment_id);
      return true;
    } catch (e) {
      toast(errorText(e), "bad");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (!(await ensureSource())) return;
    try {
      await el.play();
    } catch {
      /* @silent:teardown the browser refused autoplay-less play (a second tap plays) */
    }
  }

  async function seek(e: React.MouseEvent<HTMLButtonElement>) {
    const el = audio.current;
    if (!el || !length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    if (!(await ensureSource())) return;
    el.currentTime = (frac * length) / 1000;
    setPos(frac * length);
  }

  const played = length ? pos / length : 0;
  return (
    <div className="pt-chat-voice" data-mine={mine || undefined}>
      <button
        type="button"
        className="pt-chat-voice-play"
        onClick={() => void toggle()}
        aria-label={playing ? t("portal.chat.pause") : `${t("portal.chat.play")} (${clock(length)})`}
        disabled={loading}
      >
        <Busy busy={loading}>{playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}</Busy>
      </button>
      <button type="button" className="pt-chat-wave" onClick={(e) => void seek(e)} tabIndex={-1} aria-hidden="true">
        {shape.map((h, i) => (
          <span key={i} style={{ height: `${Math.round(h * 100)}%` }} data-on={i / shape.length < played || undefined} />
        ))}
      </button>
      <span className="pt-num w-9 shrink-0 text-right text-xs text-muted-foreground">{clock(playing || pos ? pos : length)}</span>
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setLength(d * 1000);
        }}
      />
    </div>
  );
}

/* ── a pin ───────────────────────────────────────────────────────────────── */

/**
 * A place, drawn rather than fetched: no map tiles leave for a third party
 * with the client's location in the URL. The card opens the phone's own maps
 * app, which is where anyone would want to go from here.
 */
export function LocationCard({ loc }: { loc: NonNullable<ChatMessage["location"]> }) {
  const { t } = useTranslation();
  return (
    <a href={mapsUrl(loc.lat, loc.lng)} target="_blank" rel="noopener noreferrer" className="pt-chat-place">
      <span className="pt-chat-map" aria-hidden="true">
        <span className="pt-chat-map-pin">
          <PinIcon size={30} />
        </span>
      </span>
      <span className="block px-3 pb-2.5 pt-2">
        <span className="block truncate text-sm font-semibold text-foreground">{loc.label || t("portal.chat.kind.LOCATION")}</span>
        <span className="pt-num block truncate text-xs text-muted-foreground">
          {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
        </span>
        <span className="mt-1 block text-xs font-semibold text-primary-ink">{t("portal.chat.openMap")}</span>
      </span>
    </a>
  );
}

/* ── the bubble ──────────────────────────────────────────────────────────── */

export type Sending = { state: "sending" | "failed"; pct: number | null };

/** One tick sent, two ticks read — and a clock while it is still going up. */
function Ticks({ m, sending }: { m: ChatMessage; sending?: Sending | null }) {
  const { t } = useTranslation();
  if (sending) return sending.state === "sending" ? <ClockIcon size={13} aria-label={t("portal.chat.sending")} /> : null;
  if (m.seen) return <DoubleCheckIcon size={15} className="text-primary-ink" aria-label={t("portal.chat.seen")} />;
  return <CheckIcon size={14} aria-label={t("portal.chat.sent")} />;
}

export function Bubble({
  m,
  showAuthor,
  onOpenPhoto,
  sending,
  local,
}: {
  m: ChatMessage;
  showAuthor: boolean;
  onOpenPhoto?: (a: ChatAttachment) => void;
  /** Still going up: the percentage over the photo or file, no ticks yet. */
  sending?: Sending | null;
  /** The picked file's own preview while it uploads. */
  local?: string | null;
}) {
  const { t } = useTranslation();
  const who = m.direction === "STAFF" ? m.author.name || t("portal.chat.team") : !m.mine ? m.author.email : null;
  const media = m.attachments.some((a) => a.kind === "IMAGE") || !!m.location;
  return (
    <li className={cn("flex items-end gap-2", m.mine ? "justify-end" : "justify-start")}>
      {!m.mine ? showAuthor ? <Avatar name={m.author.name} email={m.author.email} size={28} className="mb-1" /> : <span className="w-7 shrink-0" aria-hidden="true" /> : null}
      <div className={cn("pt-bubble", sending?.state === "sending" && "opacity-80")} data-mine={m.mine || undefined} data-media={media || undefined}>
        {showAuthor && who ? <p className="pt-chat-who">{who}</p> : null}
        {m.milestone && m.milestone.label ? (
          <p className="pt-chat-stage">
            <PinIcon size={12} />
            <span className="truncate">{m.milestone.label}</span>
          </p>
        ) : null}
        {m.attachments.map((a, i) => (
          <div key={a.attachment_id || i} className="relative">
            {a.kind === "IMAGE" ? (
              <PhotoTile att={a} onOpen={a.attachment_id ? onOpenPhoto : undefined} localUrl={local} />
            ) : a.kind === "VOICE" ? (
              <VoicePlayer att={a} mine={m.mine} localUrl={local} />
            ) : (
              <FileCard att={a} mine={m.mine} />
            )}
            {sending && sending.state === "sending" && sending.pct !== null ? (
              <span className="pt-chat-progress" role="status" aria-live="polite">
                <span className="pt-num">{sending.pct}%</span>
              </span>
            ) : null}
          </div>
        ))}
        {m.location ? <LocationCard loc={m.location} /> : null}
        {m.body ? <p className="pt-chat-text">{m.body}</p> : null}
        <p className="pt-chat-meta">
          <span className="pt-num">{timeOf(m.created_at)}</span>
          {m.mine ? <Ticks m={m} sending={sending} /> : null}
        </p>
      </div>
    </li>
  );
}

/** "Today", "Yesterday", then the date — centred between days. */
export function DayMarker({ label }: { label: string }) {
  return (
    <li className="my-3 flex justify-center" aria-hidden="true">
      <span className="pt-pill" data-plain>
        {label}
      </span>
    </li>
  );
}
