/**
 * The slash menu: type `/` and pick a command.
 *
 * ── A COMMAND YOU CANNOT RUN IS SHOWN, DISABLED, WITH THE REASON ────────────
 *
 * Not hidden. Someone told about `/bank` by a colleague who types it and finds
 * nothing will file a bug and lose ten minutes; someone who sees it greyed out
 * saying "you do not have access to this data" understands immediately and asks
 * the right person. The server decides which is which — this only draws it.
 *
 * ── KEYBOARD FIRST, BECAUSE THAT IS HOW IT IS OPENED ────────────────────────
 *
 * Nobody reaches for the mouse after typing "/". Arrow keys move, Enter runs,
 * Escape closes.
 *
 * ── THE ACTIVEDESCENDANT GOES ON THE EDITOR, NOT ON THIS LIST ───────────────
 *
 * Focus never leaves the editor — that is the point of a typeahead menu, and
 * moving focus into the list would strand the caret. `aria-activedescendant` is
 * only honoured on the element that HAS focus, so setting it on the listbox
 * would look right in the markup and announce nothing at all. It is written onto
 * the editor's own DOM node instead, and removed again when the menu closes.
 * Each option carries `tabIndex={-1}`: programmatically focusable, never in the
 * tab order.
 *
 * NOT `aria-expanded`, though the instinct is to add it. It is not a global
 * attribute and is invalid on `role="textbox"` — only `combobox` may carry it,
 * and re-roling a rich-text editor as a combobox would change how it is
 * announced in ordinary use to buy one attribute. `aria-controls` is global and
 * stays, so the relationship is still expressed. (axe caught this; the first
 * version of this file shipped the invalid attribute.)
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { LoadingRow } from "@/components/ui/states";
import type { CommandDescriptor } from "@/lib/mail-api";

const LISTBOX_ID = "slash-menu";

export function SlashMenu({
  commands,
  loading,
  query,
  onPick,
  onClose,
  ownerEl,
}: {
  commands: CommandDescriptor[];
  loading: boolean;
  query: string;
  onPick: (c: CommandDescriptor) => void;
  onClose: () => void;
  /** The editor's DOM node — where focus actually is. */
  ownerEl?: HTMLElement | null;
}) {
  const q = query.trim().toLowerCase();
  const matches = React.useMemo(
    () => commands.filter((c) => !q || c.key.startsWith(q) || c.label.toLowerCase().includes(q)),
    [commands, q],
  );
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => { setIndex(0); }, [q]);

  // Skips the ones that cannot run, so Enter never lands on a disabled row.
  const step = React.useCallback((delta: number) => {
    setIndex((i) => {
      const n = matches.length;
      if (!n) return 0;
      for (let k = 1; k <= n; k += 1) {
        const next = (((i + delta * k) % n) + n) % n;
        if (matches[next]?.available) return next;
      }
      return i;
    });
  }, [matches]);

  // Announce the popup on the element that holds focus, and clean up on close.
  const activeId = matches[index] ? `slash-${matches[index].key}` : null;
  React.useEffect(() => {
    if (!ownerEl) return undefined;
    ownerEl.setAttribute("aria-controls", LISTBOX_ID);
    if (activeId) ownerEl.setAttribute("aria-activedescendant", activeId);
    return () => {
      ownerEl.removeAttribute("aria-controls");
      ownerEl.removeAttribute("aria-activedescendant");
    };
  }, [ownerEl, activeId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      else if (e.key === "Enter") {
        const hit = matches[index];
        if (hit?.available) { e.preventDefault(); onPick(hit); }
      } else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [matches, index, step, onPick, onClose]);

  return (
    <div
      id={LISTBOX_ID}
      role="listbox"
      aria-label="Insert from the system"
      className="absolute bottom-full left-2 z-20 mb-1 max-h-72 w-80 overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
    >
      {loading && <LoadingRow label="Loading commands…" />}
      {!loading && matches.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          No command matches “{query}”.
        </p>
      )}
      {matches.map((c, i) => (
        <div
          key={c.key}
          id={`slash-${c.key}`}
          role="option"
          tabIndex={-1}
          aria-selected={i === index}
          aria-disabled={!c.available}
          onMouseEnter={() => c.available && setIndex(i)}
          onMouseDown={(e) => { e.preventDefault(); if (c.available) onPick(c); }}
          className={cn(
            "cursor-pointer px-3 py-2",
            !c.available && "cursor-not-allowed opacity-55",
            i === index && c.available && "bg-primary/10",
          )}
        >
          <p className="text-sm font-medium">
            <span className="num">/{c.key}</span>
            <span className="ml-2 font-normal text-muted-foreground">{c.label}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {c.available ? c.description : c.unavailable_reason || c.description}
          </p>
        </div>
      ))}
    </div>
  );
}
