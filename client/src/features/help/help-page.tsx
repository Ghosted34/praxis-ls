/**
 * Help center (example). A simple in-app guide + FAQ + shortcuts + contact.
 * Reachable from the floating action cluster's Help button and /help.
 */
import { pageShell } from "@/lib/layout";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";

const GUIDES: { title: string; body: string; to?: string }[] = [
  {
    title: "Getting started",
    body: "The Control Tower is your home. Use the top-bar areas or ⌘K to jump anywhere.",
    to: "/",
  },
  {
    title: "Operations files",
    body: "The operations file is the centre of gravity — route, milestones, costing, money and documents in one 360° view.",
    to: "/operations",
  },
  {
    title: "Finance & Treasury",
    body: "Post journals, raise proformas and invoices, record receipts, and run statements.",
    to: "/finance",
  },
  {
    title: "Test mode",
    body: "Flip LIVE/TEST in the top bar to work against sandbox data — changes there never touch live.",
    to: "/appearance",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I search?",
    a: "Press ⌘K (or Ctrl+K) anywhere, or click Search in the top bar. You can jump to screens and run quick actions.",
  },
  {
    q: "Where are my messages and notifications?",
    a: "The chat and bell icons in the top bar (and the floating button, bottom-right) — both show an unread badge.",
  },
  {
    q: "Why don't I see the Praxis AI assistant?",
    a: "The AI copilot only appears when AI is enabled for your workspace (Settings › AI Control). Once enabled, sign in again and the Praxis AI button joins the floating cluster.",
  },
  {
    q: "How do I change the look?",
    a: "Settings › Appearance — name, colours, logos, fonts and radius, with a live preview.",
  },
];

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "⌘K / Ctrl+K", what: "Open the command palette" },
  { keys: "Esc", what: "Close menus, dialogs and the palette" },
  { keys: "↑ / ↓ then Enter", what: "Navigate and run a palette result" },
];

export function HelpPage() {
  return (
    <section className={cn(pageShell.reading, "pb-16")}>
      <header className="mb-6 border-b border-border pb-4">
        <div className="micro mb-1 uppercase tracking-wide">
          <Link to="/" className="transition-colors hover:text-primary-ink">
            Hub
          </Link>{" "}
          › Help center
        </div>
        <h1 className="font-display text-3xl tracking-tight text-foreground">
          Help center
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Guides, FAQs and shortcuts for getting around the workspace.
        </p>
      </header>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <Link
            key={g.title}
            to={g.to || "/"}
            className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary"
          >
            <div className="font-display text-base text-foreground">
              {g.title}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{g.body}</p>
          </Link>
        ))}
      </div>

      <h2 className="micro mb-2 uppercase tracking-wide">Frequently asked</h2>
      <div className="mb-8 divide-y divide-border rounded-xl border border-border bg-card">
        {FAQS.map((f) => (
          <details key={f.q} className="group p-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:content-none">
              <span className="mr-2 text-muted-foreground transition-transform group-open:rotate-90 inline-block">
                ›
              </span>
              {f.q}
            </summary>
            <p className="mt-2 pl-5 text-sm text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>

      <h2 className="micro mb-2 uppercase tracking-wide">Keyboard shortcuts</h2>
      <div className="mb-8 overflow-hidden rounded-xl border border-border bg-card">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            className="flex items-center justify-between border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <span className="text-sm text-muted-foreground">{s.what}</span>
            <kbd className="rounded-md border bg-background px-2 py-0.5 text-xs font-semibold">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="font-display text-base text-foreground">
          Still stuck?
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask the Praxis AI assistant (when enabled) from the floating button,
          or reach your workspace admin. Full documentation is coming to this
          page.
        </p>
      </div>
    </section>
  );
}

export default HelpPage;
