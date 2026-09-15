/**
 * Quick actions — the ONE list of destinations the surfaces that offer them
 * share: `<FloatingActions>` on touch and `<IconRail>`'s tail on desktop.
 *
 * WHAT WAS WRONG WITH THE FAB ON DESKTOP. Phase 5 audit F9 names it precisely:
 * "a draggable floating cluster is a touch idiom; on desktop it covers the
 * bottom-right of every table and duplicates the copilot entry point that
 * already exists." All three parts were true and the first is the expensive
 * one — the cluster sits at `fixed bottom-24 right-5`, which on a list screen
 * is exactly where the last rows and the pager are. It also persisted its
 * dragged position to localStorage, so a user who once moved it out of the way
 * on one screen had moved it INTO the way on another, permanently, with no way
 * back short of clearing site data.
 *
 * Being draggable was the workaround for overlapping content. The fix is not to
 * make the overlap movable; it is to stop overlapping.
 *
 * WHAT THIS FILE IS NOW. A hook, and nothing else. It used to also export a
 * `QuickActionsMenu` — a burst-icon dropdown wedged into the title bar — and
 * that is gone at every width, deliberately:
 *
 *   - Its glyph named nothing. Every other control in that strip says what it
 *     is (search, clock, environment, language, theme, alerts, account); this
 *     one was a menu you had to open to discover.
 *   - It put Messages in the title bar while the icon rail already carried
 *     Messages, so one destination had two chrome homes and the unread count
 *     had to be duplicated between them to stay honest.
 *   - The badge it carried is where it should have been all along: on the
 *     rail's own Messages cell (`icon-rail.tsx`), which is the affordance a
 *     desktop user actually presses to read them.
 *
 * So the list lives here and the two surfaces render it. Do not add a third in
 * the header.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAiEnabled } from "@/components/ai-actions";
import { useCanOpenRoute } from "@/lib/route-access";
import { openRaiseTicket } from "@/features/support/raise-ticket-bus";

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
const FeedbackIcon = (p: IP) => (
  <svg {...s(p)}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
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
 * icon rail cannot drift into offering different things — which is how the app
 * ended up with three icon sets and four card recipes (F6).
 *
 * TWO DIFFERENT GATES, and they are not interchangeable. `aiEnabled` is the
 * TENANT's feature flag — AI is provisioned or it is not — while `canOpen` is
 * this USER's grant. Messages is the case that needs the second one: Smart
 * Comms is a module like any other, and this list renders in the icon rail and
 * in the touch cluster, so an ungated entry here is two places offering a 403.
 * Help is deliberately ungated in the registry and survives every filter,
 * which is right — the way out must not be behind a grant.
 */
export function useQuickActions(onDone?: () => void): QuickAction[] {
  const aiEnabled = useAiEnabled();
  const canOpen = useCanOpenRoute();
  const navigate = useNavigate();

  return React.useMemo(() => {
    const done = () => onDone?.();
    const list: QuickAction[] = [];
    // Feedback first, deliberately: the rail renders this list top-to-bottom,
    // so this sits ABOVE the Praxis AI icon — the position chosen for the
    // revamp, because reaching the vendor is the one action that must never
    // be two taps deep. Ungated like Help (not Messages, not AI): AI is a
    // tenant feature flag and Messages needs a /comms grant, but reaching
    // Praxis for help is ungated server-side too (feature:null), so an
    // ungated entry here is the honest shape.
    list.push({
      key: "feedback",
      label: "Feedback",
      Icon: FeedbackIcon,
      onSelect: () => {
        openRaiseTicket();
        done();
      },
    });
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
    if (canOpen("/comms")) {
      list.push({
        key: "msg",
        label: "Messages",
        Icon: ChatIcon,
        onSelect: () => {
          navigate("/comms");
          done();
        },
      });
    }
    list.push({
      key: "help",
      label: "Help",
      Icon: HelpIcon,
      onSelect: () => {
        navigate("/help");
        done();
      },
    });
    return list;
  }, [aiEnabled, canOpen, navigate, onDone]);
}
