/**
 * ⌘K command palette — the app's command center (Pixie/Lovable design).
 *
 * Two sections: JUMP TO (areas/screens — fed the same NAV the shell renders, so
 * it always matches the menu) and ACTIONS (quick commands: new dossier / invoice,
 * file a tax return, and Ask Praxis AI…). Typing filters both. Arrow keys + Enter
 * to run, Esc / backdrop to close. "Ask Praxis AI…" opens the copilot via a window
 * event so this stays decoupled from it. Data search (dossiers/invoices/people)
 * plugs into ACTIONS/JUMP once the backend exposes a search endpoint — the input
 * copy already hints at it.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";

type PaletteGroup = { heading: string; items: { to: string; label: string }[] };
type Row = {
  key: string;
  label: string;
  sub?: string;
  Icon: (p: IP) => React.JSX.Element;
  run: () => void;
};

type IP = React.SVGProps<SVGSVGElement>;
const sic = (p: IP) => ({
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 17, height: 17, "aria-hidden": true, ...p,
});
const SearchIcon = (p: IP) => (<svg {...sic(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
const TowerIcon = (p: IP) => (<svg {...sic(p)}><path d="m6 9 6-6 6 6M6 9v11h12V9" /></svg>);
const FolderIcon = (p: IP) => (<svg {...sic(p)}><path d="M4 5h6l2 3h8v11H4z" /></svg>);
const CardIcon = (p: IP) => (<svg {...sic(p)}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>);
const FleetIcon = (p: IP) => (<svg {...sic(p)}><path d="M3 7h13l5 5v4h-3" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>);
const BoxIcon = (p: IP) => (<svg {...sic(p)}><path d="M3 9l9-5 9 5v8l-9 5-9-5z" /></svg>);
const PlusIcon = (p: IP) => (<svg {...sic(p)}><path d="M12 5v14M5 12h14" /></svg>);
const FileTextIcon = (p: IP) => (<svg {...sic(p)}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></svg>);
const TaxIcon = (p: IP) => (<svg {...sic(p)}><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V9M16 16v-6" /></svg>);
const AiIcon = (p: IP) => (<svg {...sic(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>);
const ChatIcon = (p: IP) => (<svg {...sic(p)}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" /></svg>);

// Curated "Jump to" shortcuts shown when the query is empty. Full screen search
// (any NAV item) kicks in as soon as the user types.
const JUMP: { to: string; label: string; Icon: (p: IP) => React.JSX.Element }[] = [
  { to: "/", label: "Control Tower", Icon: TowerIcon },
  { to: "/operations", label: "Operations", Icon: FolderIcon },
  { to: "/finance", label: "Finance & Treasury", Icon: CardIcon },
  { to: "/fleet", label: "Fleet", Icon: FleetIcon },
  { to: "/wms", label: "Warehouse", Icon: BoxIcon },
];

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

  const go = React.useCallback((to: string) => { onClose(); navigate(to); }, [navigate, onClose]);
  const askAi = React.useCallback(() => {
    onClose();
    window.dispatchEvent(new CustomEvent("praxis:open-copilot"));
  }, [onClose]);

  // Every NAV screen, for typed search.
  const allScreens = React.useMemo(
    () => groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.heading }))),
    [groups],
  );

  const ACTIONS: Row[] = React.useMemo(() => [
    { key: "act:new-dossier", label: "New operation file", Icon: PlusIcon, run: () => go("/operations") },
    { key: "act:new-invoice", label: "New invoice", Icon: FileTextIcon, run: () => go("/finance") },
    { key: "act:file-tax", label: "File a tax return", Icon: TaxIcon, run: () => go("/finance") },
    { key: "act:messages", label: "Open Messages", Icon: ChatIcon, run: () => go("/comms") },
    { key: "act:ask-ai", label: "Ask Praxis AI…", Icon: AiIcon, run: askAi },
  ], [go, askAi]);

  const q = query.trim().toLowerCase();

  // Jump rows: curated shortcuts when empty; all matching screens when typing.
  const jumpRows: Row[] = React.useMemo(() => {
    if (!q) return JUMP.map((j) => ({ key: `jump:${j.to}`, label: j.label, Icon: j.Icon, run: () => go(j.to) }));
    return allScreens
      .filter((s) => s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q))
      .slice(0, 12)
      .map((s) => ({ key: `screen:${s.to}`, label: s.label, sub: s.group, Icon: FolderIcon, run: () => go(s.to) }));
  }, [q, allScreens, go]);

  const actionRows: Row[] = React.useMemo(
    () => (!q ? ACTIONS : ACTIONS.filter((a) => a.label.toLowerCase().includes(q))),
    [q, ACTIONS],
  );

  const rows = React.useMemo(() => [...jumpRows, ...actionRows], [jumpRows, actionRows]);

  React.useEffect(() => {
    if (!open) return;
    setQuery(""); setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  React.useEffect(() => setActive(0), [query]);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); rows[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }

  const jumpCount = jumpRows.length;
  const renderRow = (r: Row, idx: number) => (
    <button
      key={r.key}
      data-idx={idx}
      onMouseEnter={() => setActive(idx)}
      onClick={r.run}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
        idx === active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
      )}
    >
      <span className="text-[rgb(var(--primary))]"><r.Icon /></span>
      <span className="flex-1 font-medium text-foreground">{r.label}</span>
      {r.sub && <span className="micro">{r.sub}</span>}
    </button>
  );

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
          <span className="text-muted-foreground"><SearchIcon /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps, dossiers, invoices, actions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <>
              {jumpRows.length > 0 && (
                <>
                  <p className="micro px-3 pb-1 pt-2">{q ? "Screens" : "Jump to"}</p>
                  {jumpRows.map((r, i) => renderRow(r, i))}
                </>
              )}
              {actionRows.length > 0 && (
                <>
                  <p className="micro px-3 pb-1 pt-3">Actions</p>
                  {actionRows.map((r, i) => renderRow(r, jumpCount + i))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
