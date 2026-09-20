/**
 * A link's card, under the sentence that carried it.
 *
 * ── WHAT THE CARD IS FOR ───────────────────────────────────────────────────
 *
 * To let a reader decide whether to click, without clicking. That is the entire
 * job, and it is why the card is allowed to be wrong, missing, or late: the
 * message underneath says exactly what the sender wrote, and nothing depends on
 * the preview arriving. Every rule below follows from that — no skeleton that
 * implies a promise, no error state that blames the reader, no click that goes
 * somewhere other than the URL the bubble already shows.
 *
 * ── WHY IT IS CALLED A CARD AND NOT AN EMBED ────────────────────────────────
 *
 * Because there is no `<iframe>` in this file, and that is a constraint rather
 * than a preference. `frame-src` in `src/server.js` is `['self', blob:]` on
 * purpose — asserted by `tests/unit/csp-blob-media.test.js` as "same-origin and
 * blobs" — and the reason it is written down there is a real defect history:
 * framing a document the app fetched itself is safe in a way that framing
 * `https://player.somebody-elses.example` is not. So a YouTube link gets the
 * thumbnail, the length, the channel, and a button that opens YouTube in a new
 * tab with the reader's own session and the provider's own consent UI. That is
 * what WhatsApp does with a video link, it never leaks a third-party cookie from
 * a chat bubble the reader never chose to visit, and it is the version of "rich
 * embed" this product's CSP can actually ship.
 *
 * If inline playback is ever wanted, the honest sequence is: add the provider
 * origins to `frame-src` deliberately, update that test, put `sandbox` on the
 * frame, and accept the autoplay-audio problem a chat window has and a page does
 * not. It is a decision, not a prop.
 *
 * ── THE IMAGE ARRIVES THROUGH US ───────────────────────────────────────────
 *
 * `image_src` on a preview is a route on this tenant's own server, keyed on the
 * link's hash — not the remote URL. So the picture is fetched with a Bearer token
 * like every other gated file here (an `<img src>` cannot carry one), which means
 * a blob, a revocation, and lazy mounting when a thread has forty links in it.
 * The side effect is the point: the site being linked to never learns that anyone
 * at this tenant looked at the message.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/smartcomm-api";
import type { LinkPreview } from "@/lib/smartcomm-api";
import { cn } from "@/lib/cn";
import { useObjectUrl, useNearViewport } from "./use-object-url";

export type LinkTone = "primary" | "surface";

const MEDIA_LABEL: Record<string, string> = {
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
  LOOM: "Loom",
  MAPS: "Google Maps",
};

const MEDIA_ACTION: Record<string, string> = {
  YOUTUBE: "Watch on YouTube",
  VIMEO: "Watch on Vimeo",
  LOOM: "Watch on Loom",
  MAPS: "Open in Google Maps",
};

/** `1:23`, `12:04`, `1:02:07`. `clock()` in audio-utils handles mm:ss, which is
 *  right for a voice note and wrong for a 70-minute training video the sender
 *  pasted — the hour is the information. */
function videoLength(seconds?: number | null): string | null {
  const total = Math.round(Number(seconds) || 0);
  if (!total || total < 0) return null;
  const ss = String(total % 60).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}:${ss}`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
}

/**
 * The proxy-served image, or nothing at all.
 *
 * No placeholder and no broken-image icon: a card whose picture failed is a card
 * with more text, which is what a thumbnail-less link has always been. Reserving
 * a grey box for an image that will not come is the same lie as a skeleton that
 * never fills.
 */
function PreviewImage({
  preview,
  className,
}: {
  preview: LinkPreview;
  className?: string;
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const hash = preview.link_hash || null;
  const fetcher = React.useMemo(
    () => (hash ? (signal: AbortSignal) => api.linkImageObjectUrl(hash, "image", signal) : null),
    [hash],
  );
  const { url } = useObjectUrl(fetcher, { enabled: near && !!hash });
  // The aspect ratio the page declared, when it declared one. Without it the
  // card jumps as the image lands, and in a chat that scroll jump throws away
  // the message the reader was on. 1.91:1 is the og:image default, not a guess.
  const ratio = "1.918";
  if (!hash) return null;
  return (
    <div
      ref={ref}
      className={cn("relative w-full overflow-hidden rounded-t-xl bg-muted/40", className)}
      style={{ aspectRatio: ratio }}
    >
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
}

function openExternally(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function LinkCard({
  preview,
  tone,
}: {
  preview: LinkPreview;
  tone: LinkTone;
}) {
  // Which states get a card, and which get the plain link they already have:
  //   PENDING      nothing has been fetched yet (a first read queued it)
  //   EMPTY        the page answered and said nothing about itself
  //   UNREACHABLE  dead, slow, or not HTML
  //   REFUSED      the guard blocked it — private address, wrong port, and so on
  // Rendering a card for any of those would mean inventing content, and REFUSED in
  // particular must look like NOTHING rather than like a problem: it is the
  // product refusing to fetch an internal host on somebody's behalf, and telling
  // the reader "preview unavailable" would advertise that there was something to
  // be unavailable.
  if (preview.state !== "OK") return null;
  const hasBody =
    Boolean(preview.title) ||
    Boolean(preview.description) ||
    Boolean(preview.image_src) ||
    Boolean(preview.site_name);
  if (!hasBody) return null;

  const media = preview.media;
  const length = media ? videoLength(media.duration) : null;
  const onSurface = tone === "surface";

  return (
    <div
      className={cn(
        // 65% of the bubble, not 100%: a preview is a footnote to the sentence
        // above it, and a card as wide as the conversation pane reads as the
        // message instead of the aside. The text is not capped with it — the
        // words stay at bubble width, only the decoration shrinks.
        "mt-1.5 max-w-[65%] overflow-hidden rounded-xl border text-[12px] leading-snug",
        onSurface
          ? "border-border bg-muted/40"
          : "border-primary-foreground/25 bg-primary-foreground/10",
      )}
    >
      <PreviewImage preview={preview} />
      <div className="px-2.5 py-2">
        {preview.site_name || media ? (
          <div
            className={cn(
              "mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide",
              onSurface ? "text-muted-foreground" : "text-primary-foreground/80",
            )}
          >
            {media ? (
              <span aria-hidden className="text-[12px] leading-none">
                {media.kind === "MAPS" ? "📍" : "▶"}
              </span>
            ) : null}
            <span className="truncate">
              {media ? tr(MEDIA_LABEL[media.kind]) : preview.site_name}
            </span>
            {length ? (
              <span className="ml-auto shrink-0 rounded bg-muted/60 px-1 font-mono text-[10px] normal-case tabular-nums">
                {length}
              </span>
            ) : null}
          </div>
        ) : null}

        {preview.title ? (
          <div
            className={cn(
              "line-clamp-2 font-medium",
              onSurface ? "text-foreground" : "text-primary-foreground",
            )}
          >
            {preview.title}
          </div>
        ) : null}

        {preview.description ? (
          <div
            className={cn(
              "mt-0.5 line-clamp-3",
              onSurface ? "text-muted-foreground" : "text-primary-foreground/85",
            )}
          >
            {preview.description}
          </div>
        ) : null}

        {media?.author ? (
          <div
            className={cn(
              "mt-1 text-[11px]",
              onSurface ? "text-muted-foreground" : "text-primary-foreground/75",
            )}
          >
            {media.author}
          </div>
        ) : null}

        {/* One control for the whole card. The text above it is not clickable:
            a card where the title, the image and the button are three different
            hit targets that go to the same place is three chances to misjudge
            which one you are over, and on a phone one of them is a mis-tap that
            opens a browser tab in the middle of a conversation. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openExternally(media?.open_url || preview.url);
          }}
          className={cn(
            "mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
            onSurface
              ? "bg-primary/10 text-primary-ink hover:bg-primary/20"
              : // On the sender's own bubble the ground IS the accent, so an
                // accent-tinted button disappears into it (the exact failure a
                // tenant with orange branding reported). `--card` is the theme's
                // surface — white in light mode, the dark panel colour in dark —
                // so the button inverts against the accent in both themes, and
                // `--primary-ink` keeps the label in the brand colour at its
                // AA-safe weight for whichever theme is active.
                "bg-card text-primary-ink shadow-sm hover:bg-card/90",
          )}
        >
          <span className="truncate">
            {media ? tr(MEDIA_ACTION[media.kind] || "Open link") : tr("Open link")}
          </span>
          <span aria-hidden>↗</span>
          {/* The destination, for a screen reader and for anyone using the browser's
              status bar: a card must never hide where it goes. */}
          <span className="sr-only">{preview.url}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The composer's version of the card: one line, not a card.
 *
 * WhatsApp got this right and the first version here got it wrong. While a
 * message is being typed, the input is the main character — a full card above
 * it (image at og:image ratio, title, three lines of description) pushed the
 * text field out of sight the moment a URL landed, and the person then had to
 * scroll to find their own sentence. So the composer gets a strip: a small
 * square thumbnail, the title, the site, an ✕ — the height of roughly one more
 * toolbar row — and the full card stays where it belongs, on the message after
 * it is sent.
 *
 * The ✕ is about the strip, not the message. Dismissing it clears the space in
 * the composer; the sent message still earns its card, because the card on a
 * bubble is a statement about the link in the text, and hiding a strip while
 * drafting is not a decision about what the reader sees. The thumbnail arrives
 * through the same authenticated proxy as every other preview image.
 */
export function LinkPreviewStrip({
  preview,
  onDismiss,
}: {
  preview: LinkPreview;
  onDismiss: () => void;
}) {
  if (preview.state !== "OK") return null;
  const title = preview.title || preview.site_name;
  if (!title) return null;
  const site = preview.site_name && preview.title ? preview.site_name : null;
  return (
    <div className="flex min-w-0 items-center gap-2.5 border-l-2 border-primary bg-muted/40 py-1.5 pl-2.5 pr-1.5 text-[12px] leading-snug">
      <StripThumb preview={preview} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{title}</div>
        {(site || preview.description) && (
          <div className="truncate text-muted-foreground">
            {site || preview.description}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={tr("Hide preview")}
        className="shrink-0 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        ✕
      </button>
    </div>
  );
}

/** The strip's thumbnail: a fixed small square, or nothing. No aspect-ratio
 *  reservation here — the strip is one line tall either way, so a picture that
 *  never arrives costs no layout shift, only emptiness. */
function StripThumb({ preview }: { preview: LinkPreview }) {
  const hash = preview.link_hash || null;
  const fetcher = React.useMemo(
    () => (hash ? (signal: AbortSignal) => api.linkImageObjectUrl(hash, "image", signal) : null),
    [hash],
  );
  const { url } = useObjectUrl(fetcher, { enabled: !!hash });
  if (!hash || !url) return null;
  return (
    <img
      src={url}
      alt=""
      className="h-9 w-9 shrink-0 rounded-md object-cover"
    />
  );
}

/**
 * Every card a bubble earned, in the order the links appear.
 *
 * Capped at the first three. A message that pastes ten links is a person
 * forwarding a list, and ten stacked cards would bury the sentence they are
 * forwarding — the links above the cards stay clickable, so nothing is lost, only
 * un-decorated.
 */
export function LinkCards({
  urls,
  links,
  tone,
}: {
  urls?: string[] | null;
  links?: Record<string, LinkPreview>;
  tone: LinkTone;
}) {
  if (!urls?.length || !links) return null;
  const cards = urls.slice(0, 3).map((url) => links[url]).filter(Boolean);
  if (!cards.length) return null;
  return (
    <>
      {cards.map((preview) => (
        <LinkCard key={preview.url} preview={preview} tone={tone} />
      ))}
    </>
  );
}
