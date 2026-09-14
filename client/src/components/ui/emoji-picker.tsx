/**
 * The emoji picker, and the quick-reaction bar.
 *
 * ── THE DATASET IS NOT IMPORTED AT THE TOP OF THIS FILE ───────────────────
 *
 * It is `await import("@/lib/emoji-data")`, inside the effect that runs when
 * the panel first opens. That is load-bearing rather than tidy: the set is
 * ~40 KB of strings and most sessions never open the picker, so a static import
 * would put it in the main bundle and charge every login for it. Vite only
 * gives it its own chunk while NOTHING in the eager graph imports it — so if a
 * future change needs a constant from that module at render time, copy the
 * constant rather than adding the import.
 *
 * The one exception is QUICK_REACTIONS, six strings, which the bar needs before
 * anything is opened. They are declared here for that reason and nowhere else.
 *
 * ── WHY THE RECENTS LIVE IN localStorage ──────────────────────────────────
 *
 * Because they are a per-device convenience and nothing else: which emoji this
 * person reached for last on THIS machine. They are not worth a table, a
 * migration, or a round-trip, and losing them costs the user one extra scroll.
 * Every read and write is wrapped — a private window, cleared site data or a
 * thumbnail capture all make the accessor throw, and a picker that crashes
 * because it could not remember 🙏 is a worse outcome than one that forgets.
 */
import * as React from "react";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import type { Emoji, EmojiCategory } from "@/lib/emoji-data";

/** The six on the bar. Duplicated from emoji-data on purpose — see the header. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

const RECENTS_KEY = "praxis.emoji.recent";
const TONE_KEY = "praxis.emoji.tone";
const MAX_RECENTS = 24;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    /* @silent:storage — storage is unavailable or blocked; recents are a convenience */
    return fallback;
  }
}
function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* @silent:storage — quota or a private window; nothing depends on this persisting */
  }
}

/** The module shape the lazy import resolves to. Kept as a type so this file
 *  can name it without importing the values. */
type EmojiModule = typeof import("@/lib/emoji-data");


/**
 * Focus this element once, on mount.
 *
 * Not the `autoFocus` attribute: that is banned by `jsx-a11y/no-autofocus`
 * because on a PAGE it yanks focus from wherever the reader was. Inside a panel
 * the reader has just opened by pressing a button, moving focus in is the
 * correct behaviour — and doing it in an effect makes that distinction explicit
 * rather than hiding it behind an attribute that means both things.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function EmojiGrid({
  items,
  tone,
  withTone,
  onPick,
}: {
  items: Emoji[];
  tone: number;
  withTone: EmojiModule["withSkinTone"];
  onPick: (glyph: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {items.map((item, i) => {
        const glyph = withTone(item, tone);
        return (
          <button
            key={`${item.n}-${i}`}
            type="button"
            // `title` AND an accessible name: the tooltip is for the mouse, the
            // label is what a screen reader announces. A bare glyph announces
            // as its Unicode name, which for 🙏 is "folded hands" in some
            // voices and nothing at all in others.
            title={item.n}
            aria-label={item.n}
            onClick={() => onPick(glyph)}
            className="grid h-8 w-8 place-items-center rounded text-[20px] leading-none transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}

export function PickerPanel({ onPick }: { onPick: (glyph: string) => void }) {
  const searchRef = useFocusOnMount<HTMLInputElement>();
  const [mod, setMod] = React.useState<EmojiModule | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [category, setCategory] = React.useState<EmojiCategory>("people");
  const [tone, setTone] = React.useState(() => readStore<number>(TONE_KEY, 0));
  const [recents, setRecents] = React.useState<string[]>(() => readStore<string[]>(RECENTS_KEY, []));

  React.useEffect(() => {
    let alive = true;
    import("@/lib/emoji-data")
      .then((m) => { if (alive) setMod(m); })
      .catch(() => {
        // A chunk that will not load is almost always a stale service worker
        // after a deploy. Saying so is better than an empty grid, because the
        // fix — reload — is something the reader can do.
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, []);

  const pick = (glyph: string) => {
    const next = [glyph, ...recents.filter((r) => r !== glyph)].slice(0, MAX_RECENTS);
    setRecents(next);
    writeStore(RECENTS_KEY, next);
    onPick(glyph);
  };

  const chooseTone = (index: number) => {
    setTone(index);
    writeStore(TONE_KEY, index);
  };

  if (failed) {
    return (
      <div className="w-[336px] p-4 text-sm text-muted-foreground">
        {tr("Couldn't load the emoji set. Reload the page and try again.")}
      </div>
    );
  }
  if (!mod) {
    return (
      <div className="grid h-[320px] w-[336px] place-items-center text-sm text-muted-foreground">
        {tr("Loading…")}
      </div>
    );
  }

  const searching = term.trim().length > 0;
  const results = searching ? mod.searchEmoji(term) : [];
  // Recents are stored as finished glyphs (tone already applied), so they are
  // wrapped back into the Emoji shape with `t: false` — re-applying the current
  // tone to one that already carries a modifier produces a broken sequence.
  const recentItems: Emoji[] = recents.map((e) => ({ e, n: e, k: [] }));
  const shown: Emoji[] = searching
    ? results
    : category === "recent"
      ? recentItems
      : mod.EMOJI[category as Exclude<EmojiCategory, "recent">];

  const tabs: EmojiCategory[] = recents.length ? ["recent", ...mod.CATEGORY_ORDER] : mod.CATEGORY_ORDER;

  return (
    <div className="w-[336px]">
      <div className="border-b border-border p-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={tr("Search emoji")}
          aria-label={tr("Search emoji")}
          className="h-8"
          ref={searchRef}
        />
      </div>

      {!searching && (
        <div className="flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5" role="tablist">
          {tabs.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={category === c}
              title={mod.CATEGORY_LABELS[c]}
              aria-label={mod.CATEGORY_LABELS[c]}
              onClick={() => setCategory(c)}
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded text-[15px] leading-none transition-colors",
                category === c ? "bg-accent/60" : "hover:bg-accent/60",
              )}
            >
              {CATEGORY_ICON[c]}
            </button>
          ))}
        </div>
      )}

      <div className="h-[248px] overflow-y-auto p-2">
        {shown.length ? (
          <EmojiGrid items={shown} tone={tone} withTone={mod.withSkinTone} onPick={pick} />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">
            {searching ? tr("No emoji match that.") : tr("Nothing here yet.")}
          </div>
        )}
      </div>

      {/* Skin tone. Index 0 is "no modifier" and stays the default — choosing
          one on the user's behalf is not ours to do. */}
      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
        <span className="text-micro text-muted-foreground">{tr("Skin tone")}</span>
        <div className="flex gap-0.5">
          {mod.SKIN_TONES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={mod.SKIN_TONE_LABELS[i]}
              title={mod.SKIN_TONE_LABELS[i]}
              aria-pressed={tone === i}
              onClick={() => chooseTone(i)}
              className={cn(
                "grid h-6 w-6 place-items-center rounded text-[14px] leading-none transition-colors",
                tone === i ? "bg-accent/60" : "hover:bg-accent/60",
              )}
            >
              {mod.withSkinTone({ e: "✋", n: "hand", k: [], t: true }, i)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One glyph per category tab. Emoji rather than icons, which is what every
 *  picker does and what makes the row scannable without labels. */
const CATEGORY_ICON: Record<EmojiCategory, string> = {
  recent: "🕘",
  people: "😀",
  nature: "🐶",
  food: "🍎",
  activity: "⚽",
  travel: "🚚",
  objects: "📦",
  symbols: "✅",
  flags: "🏁",
};

/**
 * The smiley button and its panel.
 *
 * A Popover and not a DropdownMenu: the panel holds a search field and a
 * scrolling grid, which is content, and `menuitem` semantics over a text input
 * would promise arrow-key navigation this does not implement. See the header of
 * popover.tsx.
 */
export function EmojiPicker({
  onPick,
  disabled,
  label,
  align = "start",
}: {
  onPick: (glyph: string) => void;
  disabled?: boolean;
  label?: string;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const name = label || tr("Insert emoji");
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      label={name}
      className="p-0"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={name}
          title={name}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg leading-none text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
        >
          😊
        </button>
      }
    >
      {/* Mounted only while open, so the lazy chunk is not fetched by a thread
          that merely rendered a composer. */}
      {open && (
        <PickerPanel
          onPick={(glyph) => {
            onPick(glyph);
            // The picker stays OPEN on pick: people send several in a row, and
            // reopening between each is four clicks to type "🎉🎉".
          }}
        />
      )}
    </Popover>
  );
}

/**
 * The six-emoji bar that appears on a message.
 *
 * `mine` marks the reader's own reactions so the bar can show them pressed —
 * tapping the same one again removes it, which is what the toggle endpoint
 * already does and what every messaging app does.
 */
export function ReactionBar({
  onReact,
  mine = [],
  className,
}: {
  onReact: (emoji: string) => void;
  mine?: string[];
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-[var(--shadow-m)]", className)}>
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          aria-label={e}
          aria-pressed={mine.includes(e)}
          onClick={() => onReact(e)}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full text-[17px] leading-none transition-transform hover:scale-110",
            mine.includes(e) && "bg-accent/60",
          )}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/**
 * The reactions already ON a message, grouped and counted.
 *
 * Renders nothing at all when there are none — an empty row of zero-count
 * chips under every bubble is noise in a thread that is mostly plain text.
 */
export function ReactionChips({
  reactions,
  meId,
  onToggle,
}: {
  reactions: { emoji: string; count: number; users?: string[] }[];
  meId?: string;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => {
        const mine = !!meId && (r.users || []).includes(meId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            aria-pressed={mine}
            aria-label={`${r.emoji} ${r.count}`}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors",
              mine ? "border-primary bg-primary/10 text-primary-ink" : "border-border bg-card text-muted-foreground hover:bg-accent/60",
            )}
          >
            <span className="text-[13px]">{r.emoji}</span>
            {r.count > 1 && <span className="tabular-nums">{r.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
