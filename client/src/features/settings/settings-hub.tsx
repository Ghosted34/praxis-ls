/**
 * Settings hub — the "configure the hub" card grid (pixie reference). Sections
 * of cards; each card routes to its editor. Screens that aren't built yet route
 * to the shared ComingSoon placeholder (see doc/FE_IA_HANDOFF.md). Cards linking
 * into existing areas (Appearance, Notifications, IAM, Roles) go straight there.
 */
import { Link } from "react-router-dom";

type Card = { to: string; label: string; desc: string; icon: IconKey };
type Section = { heading: string; cards: Card[] };

const SECTIONS: Section[] = [
  {
    heading: "Identity",
    cards: [
      { to: "/settings/business-setup", label: "Business Setup", desc: "Profile, financial identity & operational policies", icon: "id" },
      { to: "/appearance", label: "Appearance", desc: "White-label theme, fonts & per-brand colours", icon: "palette" },
      { to: "/settings/login", label: "Login Screen", desc: "Hero copy, quotes, regional welcomes & toggles", icon: "login" },
      { to: "/settings/business-policies", label: "Business Policies", desc: "Privacy, Refund, QMS, Terms & more", icon: "doc" },
    ],
  },
  {
    heading: "Money",
    cards: [
      { to: "/master/currencies", label: "Currencies & FX", desc: "Currency catalogue + exchange rates", icon: "money" },
      { to: "/master/tax-jurisdictions", label: "Tax Rates", desc: "VAT, WHT & more — enabled system-wide", icon: "money" },
      { to: "/settings/payment-gateways", label: "Payment Gateways", desc: "Paydunya, Orange, Nomba, Stripe & fees", icon: "money" },
      { to: "/master/treasury-accounts", label: "Bank Accounts", desc: "Company accounts (masked) & payout links", icon: "money" },
    ],
  },
  {
    heading: "Operations",
    cards: [
      { to: "/settings/numbering", label: "Document Numbering", desc: "Prefixes, padding & sequences", icon: "ops" },
      { to: "/settings/custom-fields", label: "Custom Fields", desc: "Per-entity field definitions", icon: "ops" },
      { to: "/settings/pipeline-stages", label: "Pipeline Stages", desc: "CRM, delivery, PO & production stages", icon: "ops" },
      { to: "/settings/scheduled-reports", label: "Scheduled Reports", desc: "Automated report delivery", icon: "ops" },
      { to: "/settings/factory-languages", label: "Factory Languages", desc: "Manage translations for factory screens — no code", icon: "ops" },
    ],
  },
  {
    heading: "Communication",
    cards: [
      { to: "/settings/document-templates", label: "Document Templates", desc: "Invoices, POs, receipts, contracts", icon: "comms" },
      { to: "/settings/email-signatures", label: "Email Signatures", desc: "Brand template & per-staff render", icon: "comms" },
      { to: "/notifications", label: "Notifications", desc: "Your channel & category preferences", icon: "comms" },
    ],
  },
  {
    heading: "Integrations & Security",
    cards: [
      { to: "/settings/api-keys", label: "API Keys & Secrets", desc: "Encrypted, write-only third-party keys", icon: "key" },
      { to: "/security/users", label: "IAM & Security", desc: "Users, audit log, sessions & access", icon: "shield" },
      { to: "/security/roles", label: "Roles & Access", desc: "Permission matrix (Org & Workflow)", icon: "shield" },
      { to: "/settings/help-center", label: "Help Center", desc: "Guides & FAQs", icon: "help" },
    ],
  },
];

type IconKey = "id" | "palette" | "login" | "doc" | "money" | "ops" | "comms" | "key" | "shield" | "help";

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
    case "palette":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="8.5" cy="10" r="1" /><circle cx="15.5" cy="10" r="1" /><circle cx="12" cy="15" r="1" /></svg>;
    case "login":
      return <svg {...common}><path d="M15 3h4v18h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>;
    case "doc":
      return <svg {...common}><path d="M6 2h9l3 3v17H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case "money":
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case "ops":
      return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="8" cy="18" r="1.6" /></svg>;
    case "comms":
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
    case "key":
      return <svg {...common}><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M17 6l2 2M14 9l2 2" /></svg>;
    case "shield":
      return <svg {...common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>;
    case "help":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" /><circle cx="12" cy="17" r="0.6" /></svg>;
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

export function SettingsHub() {
  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <h1 className="font-display text-2xl tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure the hub. Business identity, money, operations, communication &amp; integrations.
      </p>

      <div className="mt-8 flex flex-col gap-8">
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

export default SettingsHub;
