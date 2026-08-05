/**
 * Praxis briefing — the standing "what needs you" line.
 *
 * The mock's version was a paragraph of fiction naming real-looking dossiers and
 * invoices ("SLAS-INV-2026-0311 is 34 days overdue, Sonara"). The iframe build
 * replaced the text with live counts but kept it as an HTML string assembled
 * with `<b>` tags and injected through `innerHTML`.
 *
 * It is now a list of facts, each one a LINK to the screen that resolves it —
 * which is the only thing a briefing is for. A count with nowhere to go is a
 * decoration. Facts that are zero are omitted rather than rendered as "0
 * awaiting approval": a briefing lists what needs doing, not what does not.
 */
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";

type Fact = { n: number; one: string; many: string; to: string };

export function Briefing({
  activeFiles,
  approvals,
  complianceFlags,
  unpostedJournals,
  isTest,
}: {
  activeFiles: number;
  approvals: number;
  complianceFlags: number;
  unpostedJournals: number;
  isTest: boolean;
}) {
  const facts: Fact[] = [
    { n: activeFiles, one: "active operation file", many: "active operation files", to: "/operations/files" },
    { n: approvals, one: "awaiting approval", many: "awaiting approval", to: "/approvals" },
    { n: complianceFlags, one: "open compliance flag", many: "open compliance flags", to: "/vault/compliance-flags" },
    { n: unpostedJournals, one: "unposted journal", many: "unposted journals", to: "/finance/journals" },
  ].filter((f) => f.n > 0);

  return (
    <Card className="mb-5 flex items-start gap-4 bg-[linear-gradient(120deg,color-mix(in_srgb,rgb(var(--brand-blue-bright))_9%,var(--card)),var(--card))] p-4">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[rgb(var(--brand-blue)_/_0.14)] text-[rgb(var(--brand-blue-ink))]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" width={18} height={18}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </span>
      <div className="min-w-0">
        <h2 className="text-micro uppercase text-muted-foreground">Praxis briefing</h2>
        {facts.length ? (
          <ul className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {facts.map((f) => (
              <li key={f.to}>
                <Link to={f.to} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  <span className="num font-semibold text-foreground">{f.n}</span> {f.n === 1 ? f.one : f.many}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">
            Nothing is waiting on you — no open files, approvals, compliance flags or unposted journals.
          </p>
        )}
        <p className="mt-1.5 text-label text-muted-foreground">
          {isTest ? "Sandbox data — the Control Tower is in TEST." : "Live from the Control Tower."}
        </p>
      </div>
    </Card>
  );
}
