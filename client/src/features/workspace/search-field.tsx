/**
 * The workspace's search box — one control for the Tasks page and the
 * Calendar, so the two read and behave the same.
 *
 * ── WHAT IT IS ─────────────────────────────────────────────────────────────
 *
 * A labelled `type="search"` input with the search glyph inside it, a clear
 * button that appears the moment there is something to clear, Escape to
 * empty it, and a DEBOUNCE between what is typed and what is reported: the
 * Tasks page turns the value into a server request, and a request per
 * keystroke is eight requests for "shipping". The Calendar filters a window
 * it already holds and could take every keystroke, but a filter that lags a
 * fraction behind the fingers is not a worse filter, and one behaviour for
 * both boxes is worth more than a millisecond.
 *
 * The value is CONTROLLED by the caller (`value`), so a search that lives in
 * the URL (`?q=`) survives a refresh and a shared link, and a caller that
 * clears its own state clears the box. What is typed and not yet reported is
 * held here, and re-synced whenever the caller's value changes from outside.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * It does not know what is being searched. The placeholder and the label are
 * the caller's, because "title, notes, file or client" is a promise the
 * Tasks page keeps server-side and the Calendar keeps client-side, and the
 * words should come from whoever keeps them.
 */
import * as React from "react";
import { Input } from "@/components/ui/input";
import { SearchIcon, XIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  id,
  delay = 250,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Accessible name — what is being searched ("Search tasks"). */
  label: string;
  placeholder?: string;
  id?: string;
  /** Milliseconds between the last keystroke and `onChange`. 0 reports at once. */
  delay?: number;
  className?: string;
}) {
  const uid = React.useId();
  const inputId = id ?? `${uid}-search`;
  const [text, setText] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // The caller changed the value from outside (a cleared filter, a link with
  // a different `?q=`): the box follows, without re-reporting it.
  React.useEffect(() => {
    setText(value);
  }, [value]);

  // Held in a ref so an inline `onChange={(q) => …}` in the caller does not
  // restart the debounce on every parent render.
  const report = React.useRef(onChange);
  React.useEffect(() => {
    report.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    if (text === value) return undefined;
    if (delay <= 0) {
      report.current(text);
      return undefined;
    }
    const t = setTimeout(() => report.current(text), delay);
    return () => clearTimeout(t);
    // `value` is deliberately not a dependency: it changing is handled above,
    // and listing it here would cancel a pending report whenever it caught up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay]);

  function clear() {
    setText("");
    report.current("");
    inputRef.current?.focus();
  }

  return (
    <div role="search" className={cn("relative min-w-[14rem] flex-1", className)}>
      <SearchIcon
        width={14}
        height={14}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        id={inputId}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        // The native clear glyph is hidden (index.css) so the one below is the
        // only affordance, in the same place on every browser.
        className={cn("pl-9 [&::-webkit-search-cancel-button]:hidden", text && "pr-9")}
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          aria-label={tr("Clear search")}
          className={cn(
            "absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "animate-pop-in",
          )}
        >
          <XIcon width={14} height={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
