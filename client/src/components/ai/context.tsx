/**
 * What the assistant knows about WHERE it was opened from, and what it is
 * allowed to be pointed at.
 *
 * Three things live here, and they are together because they are all answers to
 * "what is this conversation about?":
 *
 *   useAiScopes()      the list the composer's Scope chip and the workspace's
 *                      Spaces rail both render. ONE list, derived from the
 *                      user's actual navigation access.
 *   useScreenContext() the screen behind the drawer, resolved from the screen
 *                      registry — the "◉ Viewing: Receivables" chip.
 *   suggestionsFor()   the starter chips, which change with that screen.
 *
 * WHY SCOPES AND SPACES ARE THE SAME LIST. They were specified separately —
 * a scope selector on the composer, a Spaces section in the workspace rail —
 * and building them separately is how you end up with a product where "Finance"
 * means one thing in a dropdown and another in a sidebar. A Space IS a scope
 * you have parked a conversation in. So there is one source, it is
 * permission-aware, and a user who cannot see Finance is never offered it in
 * either place.
 *
 * PERMISSION-AWARENESS IS NOT SECURITY HERE. The backend already refuses reads
 * the caller has no grant for; narrowing this list is a UX decision — offering
 * someone a scope that can only ever answer "you don't have access to that" is
 * a dead end dressed as a feature.
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { useShell } from "@/app/layout/shell-context";
import { buildRibbon, iconForArea } from "@/app/layout/ribbon-model";
import { screenByRoute, type Screen } from "@/app/screen-registry";
import type { IP } from "./icons";

/* ────────────────────────────── scopes ────────────────────────────── */

export type AiScope = {
  /** Area key, or `all` for the unscoped default. */
  key: string;
  label: string;
  Icon: (p: IP) => React.JSX.Element;
  /** Route prefix the scope covers. Empty for `all`. */
  basePath: string;
};

const ALL_SCOPE: AiScope = {
  key: "all",
  label: "All my work",
  // Rendered by the caller as the mark; a scope of "everything" has no glyph of
  // its own that is not just a busier version of one of the others.
  Icon: () => <></>,
  basePath: "",
};

/**
 * Every scope this user may point the assistant at, in ribbon order.
 *
 * Reads the SAME `buildRibbon` the chrome does, so the scope list and the
 * navigation can never disagree about what this user can see. Areas that are
 * single screens with nothing beneath them (Support & feedback) are kept —
 * "ask about my support tickets" is a real question.
 */
export function useAiScopes(): AiScope[] {
  const { access, resolved } = useShell();
  return React.useMemo(() => {
    // Before the access read resolves, offer only `all`. A list that grows
    // under the pointer is worse than a list that starts short.
    if (!resolved) return [ALL_SCOPE];
    const areas = buildRibbon(access).flatMap((f) =>
      f.areas.map((a) => a.area),
    );
    const seen = new Set<string>();
    const scopes: AiScope[] = [ALL_SCOPE];
    for (const area of areas) {
      if (seen.has(area.key)) continue;
      seen.add(area.key);
      scopes.push({
        key: area.key,
        label: area.label,
        Icon: iconForArea(area.label),
        basePath: area.basePath,
      });
    }
    return scopes;
  }, [access, resolved]);
}

/** Resolve a stored scope key back to a scope, falling back to `all`. */
export function scopeByKey(
  scopes: AiScope[],
  key: string | null | undefined,
): AiScope {
  return scopes.find((s) => s.key === key) ?? scopes[0] ?? ALL_SCOPE;
}

/** The scope whose area contains `pathname` — what the drawer opens pre-scoped to. */
export function scopeForPath(scopes: AiScope[], pathname: string): AiScope {
  let best = ALL_SCOPE;
  let len = 0;
  for (const s of scopes) {
    if (!s.basePath) continue;
    const hit =
      pathname === s.basePath || pathname.startsWith(s.basePath + "/");
    if (hit && s.basePath.length > len) {
      len = s.basePath.length;
      best = s;
    }
  }
  return best;
}

/* ─────────────────────────── modes ─────────────────────────── */

/**
 * The assistant's POSTURE, not its model. Ask reads, Draft writes prose, Analyse
 * reaches for figures, Act proposes an operation the user then confirms.
 *
 * `Act` is deliberately last and deliberately named for the thing it does. It
 * does not skip the confirm step — nothing in this product does; it tells the
 * assistant that a proposed action is the expected SHAPE of the answer, so
 * "raise a proforma for SBX-0142" stops coming back as a paragraph explaining
 * how one would raise a proforma.
 */
export const AI_MODES = [
  { value: "ask", label: "Ask", hint: "Answer from my records" },
  { value: "draft", label: "Draft", hint: "Write it for me" },
  { value: "analyse", label: "Analyse", hint: "Figures, trends, variances" },
  { value: "act", label: "Act", hint: "Propose an action to confirm" },
] as const;

export type AiMode = (typeof AI_MODES)[number]["value"];

/* ──────────────────────── screen context ──────────────────────── */

export type ScreenContext = {
  route: string;
  /** Screen title from the registry, e.g. "Receivables". */
  label: string;
  purpose?: string;
  /** Action keys the registry says are reachable from this screen. */
  actions: string[];
  area: string;
};

/**
 * The screen the user is looking at, as the assistant should describe it.
 *
 * Resolved from `screen-registry.json` — the same map the backend ingests as
 * the app's screen corpus. That matters: the chip says "Receivables" because
 * the registry says the route is called Receivables, so the label the user
 * reads and the label the assistant reasons about are the same string.
 *
 * Returns null off-registry (a detail route, a not-yet-registered screen)
 * rather than guessing from the URL — "Viewing: /finance/invoices/8f2c" is
 * noise, and a wrong context chip is worse than none.
 */
export function useScreenContext(): ScreenContext | null {
  const { pathname } = useLocation();
  return React.useMemo(() => {
    const screen: Screen | undefined =
      screenByRoute(pathname) ??
      // One level up, so a hub's tab (/finance/receivables) still resolves when
      // only the hub itself is registered.
      screenByRoute(pathname.replace(/\/[^/]+$/, ""));
    if (!screen || screen.public) return null;
    return {
      route: screen.route,
      label: screen.title,
      purpose: screen.purpose,
      actions: screen.actions ?? [],
      area: screen.area,
    };
  }, [pathname]);
}

/* ───────────────────────── suggestions ───────────────────────── */

export type Suggestion = {
  /** What the chip reads. Short — it sits on one line. */
  label: string;
  /** What is actually sent. May be longer and more specific than the label. */
  prompt: string;
};

/**
 * Per-area starters. Written as the question a person on that desk actually
 * asks, not as a demonstration of capability — "What's overdue, and who should
 * I chase first?" is a Tuesday morning; "Summarise the receivables module" is a
 * product tour.
 *
 * Keyed on the registry's `area`, so a new screen in an existing area inherits
 * sensible starters the day it is routed, with no entry here.
 */
const AREA_STARTERS: Record<string, Suggestion[]> = {
  finance: [
    {
      label: "What's overdue?",
      prompt: "What's overdue in receivables, and who should I chase first?",
    },
    {
      label: "Cash position",
      prompt: "What's my cash position this week against what's due out?",
    },
    {
      label: "Explain a variance",
      prompt: "Which invoices moved most against last month, and why?",
    },
  ],
  operations: [
    {
      label: "What's blocked?",
      prompt:
        "Which operations files are blocked, and what is blocking each one?",
    },
    {
      label: "Files at risk",
      prompt:
        "Which open operations files are at risk of missing their milestone dates?",
    },
    {
      label: "Today's movements",
      prompt: "Summarise today's transit orders and delivery notes.",
    },
  ],
  procurement: [
    {
      label: "Awaiting approval",
      prompt: "Which purchase requests are waiting on me, and for how long?",
    },
    {
      label: "Supplier invoices",
      prompt: "Which supplier invoices are unmatched against goods received?",
    },
    {
      label: "Spend by supplier",
      prompt: "Break down this month's committed spend by supplier.",
    },
  ],
  sales: [
    {
      label: "Pipeline health",
      prompt:
        "How is the pipeline moving this month, and where is it stalling?",
    },
    {
      label: "Stale opportunities",
      prompt: "Which opportunities have had no activity in the last two weeks?",
    },
    {
      label: "Draft a follow-up",
      prompt: "Draft a follow-up note for my oldest open proposal.",
    },
  ],
  commercial: [
    {
      label: "Margin check",
      prompt: "Which quotations are priced below our target margin?",
    },
    {
      label: "Pricing variance",
      prompt: "Where has quoted pricing drifted from the tariff this month?",
    },
  ],
  costing: [
    {
      label: "Cost overruns",
      prompt: "Which files are running over their costing estimate?",
    },
    {
      label: "Open cash requests",
      prompt: "What cash requests are open, and what are they for?",
    },
  ],
  hr: [
    { label: "Who's out?", prompt: "Who is on leave or absent this week?" },
    {
      label: "Contracts expiring",
      prompt: "Which employee contracts expire in the next 60 days?",
    },
  ],
  wms: [
    {
      label: "Stock exceptions",
      prompt: "Where is stock short, over, or sitting in the wrong location?",
    },
    {
      label: "Inbound today",
      prompt:
        "What is due inbound today and what has been received against it?",
    },
  ],
  fleet: [
    {
      label: "Compliance due",
      prompt: "Which vehicles have compliance documents expiring soon?",
    },
    {
      label: "Open work orders",
      prompt: "What maintenance work orders are open and how old are they?",
    },
  ],
  vault: [
    {
      label: "Expiring documents",
      prompt: "Which compliance documents expire in the next 30 days?",
    },
  ],
  comms: [
    {
      label: "What needs a reply?",
      prompt: "What in my inbox is still waiting on a reply from me?",
    },
  ],
};

/**
 * Generic starters, for a screen whose area has no entry above.
 *
 * The first two are templated on the screen itself, which is what makes them
 * feel screen-aware rather than boilerplate: on Appraisals they read "Summarise
 * Appraisals" and "What changed in Appraisals recently?".
 */
function genericStarters(screen: ScreenContext): Suggestion[] {
  return [
    {
      label: `Summarise ${screen.label}`,
      prompt: `Summarise what I'm looking at on ${screen.label}.`,
    },
    {
      label: "What changed?",
      prompt: `What changed in ${screen.label} recently, and what needs my attention?`,
    },
  ];
}

/**
 * Starter chips for the empty drawer, given the screen behind it.
 *
 * Off-registry (null screen) falls back to the cross-module three the copilot
 * has always shown — a drawer opened from an unregistered detail route should
 * still offer something, and the desk-level questions are never wrong.
 */
export function suggestionsFor(screen: ScreenContext | null): Suggestion[] {
  if (!screen) return DESK_STARTERS.slice(0, 3);
  const byArea = AREA_STARTERS[screen.area];
  if (byArea?.length) return byArea.slice(0, 3);
  return genericStarters(screen);
}

/** Cross-module questions — the workspace's landing deck and the fallback set. */
export const DESK_STARTERS: Suggestion[] = [
  {
    label: "What needs me today?",
    prompt: "What across my desk needs my attention today, in priority order?",
  },
  {
    label: "Overdue receivables",
    prompt: "What's overdue in receivables, and who should I chase first?",
  },
  {
    label: "Open operations files",
    prompt: "Summarise my open operations files and flag the ones at risk.",
  },
  {
    label: "Waiting on my approval",
    prompt:
      "What is waiting on my approval, and how long has each been waiting?",
  },
];
