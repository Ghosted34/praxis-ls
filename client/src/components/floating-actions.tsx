/**
 * Floating action cluster (Pixie "Hub" floatbar) — a primary FAB, bottom-right,
 * that expands into round quick-action buttons: Praxis AI (opens the copilot),
 * Messages (Smart Comms), and Help. The primary button carries an unread badge.
 * The AI action only appears when the tenant's AI is enabled.
 *
 * Praxis AI opens the copilot via the `praxis:open-copilot` window event, so this
 * stays decoupled from the copilot component (which owns the panel).
 *
 * The cluster is draggable: press-and-drag the primary FAB to move it anywhere on
 * screen; the drop position is remembered (localStorage) across reloads. A small
 * move threshold distinguishes a drag from a click, so tapping still toggles the
 * menu. Anchored by the FAB's bottom edge so the actions still expand upward.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAiEnabled } from "@/components/ai-actions";
import { cn } from "@/lib/cn";

type IP = React.SVGProps<SVGSVGElement>;
const s = (p: IP) => ({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, width: 20, height: 20, "aria-hidden": true, ...p });
const AiIcon = (p: IP) => (<svg {...s(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>);
const ChatIcon = (p: IP) => (<svg {...s(p)}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" /></svg>);
const HelpIcon = (p: IP) => (<svg {...s(p)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 013.5-1.8c1 .5 1.5 1.6 1 2.6-.4.9-1.5 1.2-2 2-.2.4-.2.8-.2 1.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></svg>);
const ClockIcon = (p: IP) => (<svg {...s(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
const BurstIcon = (p: IP) => (<svg {...s(p)} width={24} height={24}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" /><circle cx="12" cy="12" r="2.5" /></svg>);

export function FloatingActions({ badge = 0 }: { badge?: number }) {
  const aiEnabled = useAiEnabled();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Draggable position (FAB top-left, viewport px). null → default bottom-right
  // anchor. Persisted so it stays where the user drops it.
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(() => {
    try { const raw = localStorage.getItem("praxis.fab.pos"); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const posRef = React.useRef(pos);
  posRef.current = pos;
  const draggedRef = React.useRef(false); // set during a drag so the click toggle is suppressed

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const sx = e.clientX, sy = e.clientY;
    const FAB = 56, PAD = 8;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true; draggedRef.current = true; setOpen(false);
      const x = Math.min(Math.max(PAD, ev.clientX - dx), window.innerWidth - FAB - PAD);
      const y = Math.min(Math.max(PAD, ev.clientY - dy), window.innerHeight - FAB - PAD);
      const p = { x, y }; posRef.current = p; setPos(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && posRef.current) { try { localStorage.setItem("praxis.fab.pos", JSON.stringify(posRef.current)); } catch { /* ignore */ } }
      setTimeout(() => { draggedRef.current = false; }, 0); // let the click that follows read it, then reset
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Anchor by the RIGHT + BOTTOM edge. The cluster is right-aligned (items-end),
  // so anchoring the left edge made the FAB drift sideways whenever the actions
  // expanded and widened the container; pinning the right edge keeps the FAB
  // exactly where it was dropped, and the actions still expand up-and-leftward.
  const containerStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!pos) return undefined;
    const FAB = 56, PAD = 8;
    const x = Math.min(Math.max(PAD, pos.x), window.innerWidth - FAB - PAD);
    const y = Math.min(Math.max(PAD, pos.y), window.innerHeight - FAB - PAD);
    return { left: "auto", top: "auto", right: window.innerWidth - (x + FAB), bottom: window.innerHeight - (y + FAB) };
  }, [pos]);

  // Open on hover (with a short grace delay so moving between buttons doesn't
  // snap it shut); click still toggles for touch/keyboard. Suppressed mid-drag so
  // the cluster doesn't expand while you're moving it.
  const openNow = () => { if (draggedRef.current) return; if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const closeSoon = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 220); };

  // Live clock shown at the top of the expanded cluster (replaces the Lovable
  // mock's standalone floating clock).
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id); }, []);
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const actions = [
    aiEnabled && {
      key: "ai",
      label: "Praxis AI",
      Icon: AiIcon,
      onClick: () => { window.dispatchEvent(new CustomEvent("praxis:open-copilot")); setOpen(false); },
    },
    { key: "msg", label: "Messages", Icon: ChatIcon, onClick: () => { navigate("/comms"); setOpen(false); } },
    { key: "help", label: "Help", Icon: HelpIcon, onClick: () => { navigate("/help"); setOpen(false); } },
  ].filter(Boolean) as { key: string; label: string; Icon: (p: IP) => React.JSX.Element; onClick: () => void }[];

  // Portal to <body> so position:fixed is viewport-relative. A transformed page
  // ancestor would otherwise become the containing block, so the drag math (which
  // uses viewport-relative pointer + rect coords) would land the FAB in the wrong
  // place and it would drift away from the cursor.
  return createPortal(
    <div ref={ref} style={containerStyle} onMouseEnter={openNow} onMouseLeave={closeSoon} className="fixed bottom-24 right-5 z-50 flex flex-col items-end gap-3 md:bottom-6">
      {open && (
        <div className="flex items-center gap-2 animate-fade-in">
          <span className="rounded-md border bg-popover px-2 py-1 text-xs font-medium tabular-nums text-foreground shadow-md">{timeStr}</span>
          <div className="grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg" aria-label={`Current time ${timeStr}`}>
            <ClockIcon />
          </div>
        </div>
      )}
      {open &&
        actions.map((a, i) => (
          <div key={a.key} className="flex items-center gap-2 animate-fade-in" style={{ animationDelay: `${i * 30}ms` }}>
            <span className="rounded-md border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-md">{a.label}</span>
            <button
              onClick={a.onClick}
              title={a.label}
              aria-label={a.label}
              className="grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground shadow-lg transition-transform hover:scale-105 hover:text-[rgb(var(--primary))]"
            >
              <a.Icon />
            </button>
          </div>
        ))}
      <button
        onPointerDown={startDrag}
        onClick={() => { if (draggedRef.current) return; setOpen((o) => !o); }}
        aria-label="Quick actions (drag to move)"
        aria-expanded={open}
        className={cn(
          "relative grid h-14 w-14 cursor-grab touch-none select-none place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform hover:scale-105 active:cursor-grabbing",
          open && "rotate-45",
        )}
      >
        <BurstIcon />
        {badge > 0 && !open && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </div>,
    document.body,
  );
}
