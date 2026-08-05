/**
 * Quick actions — the DESKTOP home for what the floating cluster carries on
 * touch (Phase 5, audit F9).
 *
 * WHAT WAS WRONG WITH THE FAB ON DESKTOP. F9 names it precisely: "a draggable
 * floating cluster is a touch idiom; on desktop it covers the bottom-right of
 * every table and duplicates the copilot entry point that already exists." All
 * three parts were true and the first is the expensive one — the cluster sits at
 * `fixed bottom-24 right-5`, which on a list screen is exactly where the last
 * rows and the pager are. It also persisted its dragged position to
 * localStorage, so a user who once moved it out of the way on one screen had
 * moved it INTO the way on another, permanently, with no way back short of
 * clearing site data.
 *
 * Being draggable was the workaround for overlapping content. The fix is not to
 * make the overlap movable; it is to stop overlapping.
 *
 * WHAT REPLACES IT. A menu button in the top bar, next to the other global
 * controls. It occupies chrome the app already reserves, so it covers nothing.
 * It is a Radix `DropdownMenu`, so arrow keys, Home/End, type-ahead, Escape and
 * the focus cycle come from the library rather than from the nothing the old
 * cluster had.
 *
 * THE BADGE IS NOT DECORATION. The FAB carried the unread-messages count, and
 * the top bar deliberately does NOT duplicate Messages ("Messages lives on the
 * Smart Comms floating pin" — app-shell.tsx). So removing the FAB from desktop
 * would have removed the only unread-messages indicator a desktop user has. The
 * trigger carries it instead; that is why this is a badge and not just an icon.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useAiEnabled } from "@/components/ai-actions";
import { useClockPunch } from "@/components/clock-punch";
import { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from "@/components/ui/dropdown-menu";

type IP = React.SVGProps<SVGSVGElement>;
const s = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
  "aria-hidden": true,
  ...p,
});
const AiIcon = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);
const ChatIcon = (p: IP) => (
  <svg {...s(p)}>
    <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" />
  </svg>
);
const HelpIcon = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 013.5-1.8c1 .5 1.5 1.6 1 2.6-.4.9-1.5 1.2-2 2-.2.4-.2.8-.2 1.2" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" />
  </svg>
);
const ClockIcon = (p: IP) => (
  <svg {...s(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const BurstIcon = (p: IP) => (
  <svg {...s(p)} width={18} height={18}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export type QuickAction = {
  key: string;
  label: string;
  Icon: (p: IP) => React.JSX.Element;
  onSelect: () => void;
};

/**
 * The destinations both surfaces offer. Shared so the touch cluster and the
 * desktop menu cannot drift into offering different things — which is how the
 * app ended up with three icon sets and four card recipes (F6).
 */
export function useQuickActions(onDone?: () => void): QuickAction[] {
  const aiEnabled = useAiEnabled();
  const navigate = useNavigate();

  return React.useMemo(() => {
    const done = () => onDone?.();
    const list: QuickAction[] = [];
    if (aiEnabled) {
      list.push({
        key: "ai",
        label: "Praxis AI",
        Icon: AiIcon,
        // A window event rather than a prop or a context: the copilot owns its
        // own panel and lives in a different subtree.
        onSelect: () => {
          window.dispatchEvent(new CustomEvent("praxis:open-copilot"));
          done();
        },
      });
    }
    list.push({ key: "msg", label: "Messages", Icon: ChatIcon, onSelect: () => { navigate("/comms"); done(); } });
    list.push({ key: "help", label: "Help", Icon: HelpIcon, onSelect: () => { navigate("/help"); done(); } });
    return list;
  }, [aiEnabled, navigate, onDone]);
}

/** The top-bar menu. Desktop only — `md:hidden` keeps the FAB below that. */
export function QuickActionsMenu({ badge = 0 }: { badge?: number }) {
  const actions = useQuickActions();
  const clock = useClockPunch();

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          // Named including the count, because a badge is a picture: a screen
          // reader user should hear "Quick actions, 3 unread" from the button
          // itself rather than have to open it to find out.
          aria-label={badge > 0 ? `Quick actions, ${badge} unread` : "Quick actions"}
          className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <BurstIcon />
          {badge > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-brand-blue px-1 text-[10px] font-bold text-white ring-2 ring-background"
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </button>
      }
    >
      <DropdownLabel>
        <span className="micro">Quick actions</span>
      </DropdownLabel>
      {actions.map((a) => (
        <DropdownItem key={a.key} onSelect={a.onSelect}>
          <a.Icon /> {a.label}
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <DropdownItem
        disabled={clock.busy}
        onSelect={() => {
          void clock.toggle();
        }}
      >
        <ClockIcon />
        <span className="flex-1">{clock.action}</span>
        <span
          className={cn(
            "text-micro tabular-nums",
            clock.msg?.bad ? "text-[rgb(var(--bad))]" : clock.clockedIn ? "text-[rgb(var(--ok))]" : "text-muted-foreground",
          )}
        >
          {clock.label}
        </span>
      </DropdownItem>
    </DropdownMenu>
  );
}
