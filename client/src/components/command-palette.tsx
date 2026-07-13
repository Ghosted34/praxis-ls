/**
 * ⌘K command palette — jump to any screen. Fed the same NAV groups the app
 * shell renders, so it always matches the menu. Filters by screen or group
 * name; arrow keys + Enter to navigate, Esc / backdrop to close. Data search
 * (dossiers / invoices / people) is a later add-on once the backend exposes a
 * search endpoint — the input copy hints at it but this only routes to screens.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";

type PaletteGroup = { heading: string; items: { to: string; label: string }[] };
type Item = { to: string; label: string; group: string };

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={17}
      height={17}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CommandPalette({
  open,
  groups,
  onClose,
}: {
  open: boolean;
  groups: PaletteGroup[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const all: Item[] = React.useMemo(
    () => groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.heading }))),
    [groups],
  );

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q),
    );
  }, [all, query]);

  // Reset + focus on open.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  React.useEffect(() => setActive(0), [query]);

  // Keep the active row in view as it moves.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    navigate(to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[active];
      if (item) go(item.to);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="lux-card shadow-l relative z-10 w-full max-w-xl overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b px-4">
          <span className="text-muted-foreground">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a screen…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No screens match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            results.map((it, i) => (
              <button
                key={it.to}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it.to)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                  i === active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                <span className="font-medium text-foreground">{it.label}</span>
                <span className="micro">{it.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
