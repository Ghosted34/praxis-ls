/**
 * Governance hub — the oversight landing, same card-grid pattern as the Settings
 * hub. Collapses the old flat Governance nav group (audit / notifications /
 * workflows / approvals) into one entry that opens this hub; each card routes to
 * its screen.
 */
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/data-list";

type IconKey = "audit" | "approvals" | "workflows" | "bell";
type Card = { to: string; label: string; desc: string; icon: IconKey };
type Section = { heading: string; cards: Card[] };

const SECTIONS: Section[] = [
  {
    heading: "Oversight",
    cards: [
      { to: "/approvals", label: "Approvals", desc: "Items awaiting your decision, and open approval chains", icon: "approvals" },
      { to: "/workflows", label: "Workflows", desc: "Approval chains — steps, roles and amount bands", icon: "workflows" },
      { to: "/audit", label: "Audit ledger", desc: "Append-only trail of every security-critical action", icon: "audit" },
      { to: "/notifications", label: "Notifications", desc: "Your inbox, plus channel and category preferences", icon: "bell" },
    ],
  },
];

function Glyph({ name }: { name: IconKey }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 18,
    height: 18,
    "aria-hidden": true,
  };
  switch (name) {
    case "audit":
      return <svg {...common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="m9 12 2 2 4-4" /></svg>;
    case "approvals":
      return <svg {...common}><path d="M4 12l5 5L20 6" /></svg>;
    case "workflows":
      return <svg {...common}><rect x="3" y="4" width="6" height="4" rx="1" /><rect x="15" y="16" width="6" height="4" rx="1" /><path d="M6 8v6a2 2 0 0 0 2 2h7" /></svg>;
    case "bell":
      return <svg {...common}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
    default:
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3" /></svg>;
  }
}

function ChevIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function GovernanceHub() {
  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader title="Governance" description="Oversight in one place — approvals, workflow chains, the audit trail and your notifications." />

      <div className="mt-2 flex flex-col gap-8">
        {SECTIONS.map((s) => (
          <div key={s.heading}>
            <p className="micro mb-3">{s.heading}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {s.cards.map((c) => (
                <Link
                  key={c.to + c.label}
                  to={c.to}
                  className="lux-card group flex items-start gap-3 p-4 transition-colors hover:bg-accent/50"
                >
                  <span className="mt-0.5 text-primary">
                    <Glyph name={c.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{c.label}</span>
                      <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5">
                        <ChevIcon />
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{c.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default GovernanceHub;
