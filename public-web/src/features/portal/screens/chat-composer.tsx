/**
 * Writing in the chat: words, photos and PDFs, a voice note, a location.
 *
 * The composer is the one row a phone keeps under the thumb, so it holds only
 * what is used every time — the text, a + for everything else, and a single
 * button that is a microphone while the box is empty and "send" once it is
 * not, the way every messaging app on the person's phone behaves.
 *
 * Picked photos and PDFs wait in a tray above the box with their previews —
 * the look before sending that CLAUDE.md asks of every upload — and the text
 * becomes the caption of the first. Each file then goes up as its own message
 * with its own percentage; a burst of five photos is five bubbles, in order.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FilePicker } from "@/components/ui/file-input";
import { compressImage, isPreviewableImage, isSafeBlobUrl, previewUrlFor } from "@/lib/image-compress";
import { cn } from "@/lib/cn";
import { currentLocale } from "@/lib/i18n";
import { Sheet, TextField, useToast, IconDisc } from "../ui/kit";
import { PlusIcon, SendIcon, MicIcon, CloseIcon, CameraIcon, ImageIcon, PinIcon, TrashIcon, DocIcon } from "../ui/icons";
import { useVoiceRecorder, locate, clock, MAX_VOICE_MS, type Fix, type Recording } from "../lib/chat-media";
import { formatBytes } from "../ui/upload";

const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp,application/pdf";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TRAY = 10;

export type Outgoing =
  | { kind: "TEXT"; body: string }
  | { kind: "IMAGE" | "FILE"; body: string; file: File; previewUrl: string | null; width: number | null; height: number | null }
  | { kind: "VOICE"; recording: Recording }
  | { kind: "LOCATION"; fix: Fix; label: string };

type Tray = { id: string; file: File; previewUrl: string | null; width: number | null; height: number | null; kind: "IMAGE" | "FILE" };

/** The pixel size of a picked photo, read from its own preview. */
function dimensions(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

let seq = 0;

/** "12 m" in the reader's language — the unit is the platform's, not a string of ours. */
const metres = (n: number) => new Intl.NumberFormat(currentLocale(), { style: "unit", unit: "meter", maximumFractionDigits: 0 }).format(n);

export function Composer({
  onSend,
  stage,
  onClearStage,
  draft,
}: {
  onSend: (items: Outgoing[]) => void;
  stage: { id: string; label: string } | null;
  onClearStage: () => void;
  draft?: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = React.useState(draft || "");
  const [tray, setTray] = React.useState<Tray[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const [attach, setAttach] = React.useState(false);
  const [place, setPlace] = React.useState<{ fix: Fix | null; label: string; error: string | null } | null>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceRecorder();

  // The previews are object URLs; the tray revokes what it no longer shows.
  const trayRef = React.useRef(tray);
  trayRef.current = tray;
  React.useEffect(
    () => () =>
      trayRef.current.forEach((x) => {
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      }),
    [],
  );

  const coarse = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const hasText = !!text.trim();
  const ready = hasText || tray.length > 0;

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }

  async function pick(files: FileList | null) {
    setAttach(false);
    const list = files ? [...files] : [];
    if (!list.length) return;
    if (tray.length + list.length > MAX_TRAY) toast(t("portal.chat.tooMany"), "bad");
    setPreparing(true);
    const added: Tray[] = [];
    try {
      for (const f of list.slice(0, Math.max(0, MAX_TRAY - tray.length))) {
        // HEIC arrives with an empty or heic type and the server's sniff
        // refuses it — say so now, before the upload.
        if (!TYPES.includes(f.type)) {
          toast(t("portal.upload.badType"), "bad");
          continue;
        }
        // "document": downsized, never tonally corrected — a photo of a seal
        // or a damaged box is evidence, and must still match what was seen.
        const { file } = await compressImage(f, "document");
        if (file.size > MAX_BYTES) {
          toast(t("portal.upload.tooBig", { limit: formatBytes(MAX_BYTES) }), "bad");
          continue;
        }
        const previewUrl = isPreviewableImage(file) ? previewUrlFor(file) : null;
        const size = previewUrl ? await dimensions(previewUrl) : null;
        seq += 1;
        added.push({
          id: `t${seq}`,
          file,
          previewUrl,
          width: size ? size.width : null,
          height: size ? size.height : null,
          kind: file.type === "application/pdf" ? "FILE" : "IMAGE",
        });
      }
    } catch {
      toast(t("portal.upload.unreadable"), "bad");
    } finally {
      setPreparing(false);
    }
    if (added.length) setTray((l) => [...l, ...added]);
  }

  function drop(id: string) {
    setTray((l) => {
      const hit = l.find((x) => x.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return l.filter((x) => x.id !== id);
    });
  }

  function submit() {
    if (!ready) return;
    const body = text.trim();
    const items: Outgoing[] = tray.length
      ? tray.map((x, i) => ({ kind: x.kind, body: i === 0 ? body : "", file: x.file, previewUrl: x.previewUrl, width: x.width, height: x.height }))
      : [{ kind: "TEXT", body }];
    // The previews now belong to the outgoing bubbles, which hand them to the
    // saved messages — the tray must not revoke them.
    setTray([]);
    setText("");
    if (box.current) {
      box.current.style.height = "auto";
      box.current.focus();
    }
    onSend(items);
  }

  async function record() {
    const ok = await voice.start();
    if (!ok) toast(t(voice.error === "unsupported" || typeof MediaRecorder === "undefined" ? "portal.chat.micUnsupported" : "portal.chat.micOff"), "bad");
  }

  async function finishVoice(keep: boolean) {
    const rec = await voice.stop(keep);
    if (keep && rec) onSend([{ kind: "VOICE", recording: rec }]);
  }

  async function findMe() {
    setAttach(false);
    setPlace({ fix: null, label: "", error: null });
    try {
      const fix = await locate();
      setPlace((p) => (p ? { ...p, fix } : p));
    } catch (e) {
      setPlace((p) => (p ? { ...p, error: (e as Error).message === "denied" ? t("portal.chat.locationOff") : t("portal.chat.locationFailed") } : p));
    }
  }

  function sendPlace() {
    if (!place?.fix) return;
    onSend([{ kind: "LOCATION", fix: place.fix, label: place.label.trim() }]);
    setPlace(null);
  }

  const recording = voice.state === "recording";

  return (
    <div className="pt-chat-composer">
      {stage ? (
        <div className="mb-2 flex">
          <span className="pt-pill max-w-full" data-tone="brand" data-plain>
            <PinIcon size={14} />
            <span className="truncate">{t("portal.chat.aboutStage", { stage: stage.label })}</span>
            <button type="button" className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-full" aria-label={t("portal.chat.removeStage")} onClick={onClearStage}>
              <CloseIcon size={12} />
            </button>
          </span>
        </div>
      ) : null}

      {tray.length ? (
        <ul className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label={t("portal.chat.attach")}>
          {tray.map((x) => (
            <li key={x.id} className="pt-chat-tray-item">
              {isSafeBlobUrl(x.previewUrl) ? (
                <img src={x.previewUrl} alt="" />
              ) : (
                <span className="grid h-full w-full place-items-center gap-0.5 p-1 text-center">
                  <DocIcon size={22} />
                  <span className="w-full truncate text-[0.625rem] font-semibold text-muted-foreground">{x.file.name}</span>
                </span>
              )}
              <button type="button" className="pt-chat-tray-x" aria-label={t("portal.chat.removeFile", { name: x.file.name })} onClick={() => drop(x.id)}>
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {recording ? (
        <div className="flex items-center gap-2" role="group" aria-label={t("portal.chat.recording")}>
          <button type="button" className="pt-icon-btn shrink-0 text-[rgb(var(--bad))]" aria-label={t("portal.chat.deleteVoice")} onClick={() => void finishVoice(false)}>
            <TrashIcon size={22} />
          </button>
          <div className="flex min-h-[48px] flex-1 items-center gap-3 rounded-[24px] bg-[var(--pt-soft)] px-4">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[rgb(var(--bad))]" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">{t("portal.chat.recording")}</span>
            <span className="pt-num ml-auto text-sm text-muted-foreground" aria-live="off">
              {clock(voice.elapsed)} / {clock(MAX_VOICE_MS)}
            </span>
          </div>
          <button type="button" className="pt-btn pt-btn-primary !h-12 !min-h-0 !w-12 shrink-0 !rounded-full !p-0" aria-label={t("portal.chat.sendVoice")} onClick={() => void finishVoice(true)}>
            <SendIcon size={20} />
          </button>
        </div>
      ) : (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <button type="button" className="pt-icon-btn mb-1 shrink-0 text-muted-foreground" aria-label={t("portal.chat.attach")} onClick={() => setAttach(true)} disabled={preparing}>
            <PlusIcon size={24} />
          </button>
          <label htmlFor="pt-chat-box" className="sr-only">
            {tray.length ? t("portal.chat.caption") : t("portal.chat.placeholder")}
          </label>
          <textarea
            id="pt-chat-box"
            ref={box}
            rows={1}
            value={text}
            data-autofocus
            placeholder={tray.length ? t("portal.chat.caption") : t("portal.chat.placeholder")}
            className="pt-field max-h-36 min-h-[48px] flex-1 resize-none !rounded-[24px] !py-3"
            onChange={(e) => {
              setText(e.target.value);
              resize(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !coarse) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {ready ? (
            <button type="submit" className="pt-btn pt-btn-primary !h-12 !min-h-0 !w-12 shrink-0 !rounded-full !p-0" aria-label={t("portal.chat.send")} disabled={preparing}>
              <SendIcon size={20} />
            </button>
          ) : (
            <button
              type="button"
              className={cn("pt-btn pt-btn-soft !h-12 !min-h-0 !w-12 shrink-0 !rounded-full !p-0")}
              aria-label={t("portal.chat.record")}
              onClick={() => void record()}
              disabled={voice.state === "starting" || preparing}
            >
              <MicIcon size={22} />
            </button>
          )}
        </form>
      )}

      {/* ── the +: camera, photos & PDFs, location ── */}
      <Sheet open={attach} onClose={() => setAttach(false)} title={t("portal.chat.attach")}>
        <div className="grid grid-cols-3 gap-3 pb-1">
          <FilePicker
            accept="image/*"
            capture="environment"
            label={t("portal.chat.takePhoto")}
            onPick={(f) => void pick(f)}
            trigger={
              <span className="pt-card pt-card-press flex h-full flex-col items-center justify-center gap-2 px-2 py-4 text-center">
                <IconDisc tone="brand">
                  <CameraIcon />
                </IconDisc>
                <span className="text-sm font-semibold text-foreground">{t("portal.chat.takePhoto")}</span>
              </span>
            }
          />
          <FilePicker
            accept={ACCEPT}
            multiple
            label={t("portal.chat.photosFiles")}
            onPick={(f) => void pick(f)}
            trigger={
              <span className="pt-card pt-card-press flex h-full flex-col items-center justify-center gap-2 px-2 py-4 text-center">
                <IconDisc tone="info">
                  <ImageIcon />
                </IconDisc>
                <span className="text-sm font-semibold text-foreground">{t("portal.chat.photosFiles")}</span>
              </span>
            }
          />
          <button type="button" className="pt-card pt-card-press flex h-full flex-col items-center justify-center gap-2 px-2 py-4 text-center" onClick={() => void findMe()}>
            <IconDisc tone="ok">
              <PinIcon />
            </IconDisc>
            <span className="text-sm font-semibold text-foreground">{t("portal.chat.location")}</span>
          </button>
        </div>
      </Sheet>

      {/* ── a location, confirmed before it is sent ── */}
      <Sheet
        open={!!place}
        onClose={() => setPlace(null)}
        title={t("portal.chat.location")}
        footer={
          <button type="button" className="pt-btn pt-btn-primary pt-btn-block" disabled={!place?.fix} onClick={sendPlace}>
            <SendIcon size={20} />
            {t("portal.chat.sendLocation")}
          </button>
        }
      >
        {place?.error ? (
          <p role="alert" className="text-sm text-[rgb(var(--bad))]">
            {place.error}
          </p>
        ) : !place?.fix ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("portal.chat.locating")}
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="pt-chat-place !max-w-none">
              <span className="pt-chat-map" aria-hidden="true">
                <span className="pt-chat-map-pin">
                  <PinIcon size={30} />
                </span>
              </span>
              <span className="pt-num block px-3 py-2 text-xs text-muted-foreground">
                {place.fix.lat.toFixed(5)}, {place.fix.lng.toFixed(5)}
                {place.fix.accuracy ? ` ± ${metres(place.fix.accuracy)}` : ""}
              </span>
            </div>
            <TextField
              label={t("portal.chat.locationLabel")}
              value={place.label}
              maxLength={200}
              placeholder={t("portal.chat.locationPlaceholder")}
              onChange={(e) => setPlace((p) => (p ? { ...p, label: e.target.value } : p))}
            />
          </div>
        )}
      </Sheet>
    </div>
  );
}
