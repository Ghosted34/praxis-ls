import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * Track & trace — the one functional object on the homepage, and the reason this
 * widget lives in `components/site/` rather than in a feature folder: it is the
 * same control on the hero, on the dedicated page and (later) in a section band,
 * and three copies of a search box is how three copies of its validation start to
 * disagree.
 *
 * ── WHY SUBMITTING WRITES A URL ────────────────────────────────────────────
 *
 * `?ref=…`, not component state. A tracking lookup is the single most shared
 * string in this business: it is read off a phone, pasted into WhatsApp, and
 * typed back by somebody at the other end. A widget that keeps its result in
 * React throws that away — the reader cannot bookmark it, cannot go back to it,
 * and cannot send it. With the reference in the address the page is a document
 * again, and the fetch that follows is the same one `/public/track` does, so the
 * homepage and the page cannot drift.
 *
 * `compact` renders the hero box (input + button inline, on the dark band's
 * plate); `page` renders the full-width form above the result panel.
 */
export function TrackWidget({
  variant = "compact",
  onDark = false,
}: {
  variant?: "compact" | "page";
  onDark?: boolean;
}) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const inUrl = params.get("ref") || "";
  const [value, setValue] = React.useState(inUrl);

  // Back/forward between two references has to move the box with it, or the
  // field shows one shipment while the panel below shows another.
  React.useEffect(() => {
    setValue(inUrl);
  }, [inUrl]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    if (variant === "page") {
      setParams({ ref: v });
      return;
    }
    nav(`/public/track?ref=${encodeURIComponent(v)}`);
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label={t("site.track.title")}
      className={cn(
        variant === "compact"
          ? "flex w-full max-w-lg flex-col gap-2 sm:flex-row"
          : "flex w-full flex-col gap-2 sm:flex-row",
      )}
    >
      <label htmlFor={`track-ref-${variant}`} className="sr-only">
        {t("site.track.label")}
      </label>
      <input
        id={`track-ref-${variant}`}
        name="ref"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("site.track.placeholder")}
        autoComplete="off"
        spellCheck={false}
        // A reference is a code: capitalisation and autocorrect are corruption,
        // and "not found" is the answer they produce.
        autoCapitalize="characters"
        autoCorrect="off"
        className={cn(
          "field min-h-11 flex-1 font-mono tracking-tight",
          onDark &&
            "border-transparent bg-[rgb(237_238_238/0.08)] text-[var(--hero-foreground)] placeholder:text-[var(--hero-muted)]",
        )}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className={cn(
          "min-h-11 shrink-0 rounded-[calc(var(--radius)-2px)] px-6 text-sm font-semibold transition-colors disabled:opacity-55",
          onDark ? "btn-onhero" : "btn-primary",
        )}
      >
        {t("site.track.submit")}
      </button>
    </form>
  );
}
